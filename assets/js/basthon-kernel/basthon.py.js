"""
This is the Python part of the Basthon Kernel.
"""


import pyodide
import sys
import os
import pydoc
from js import document, window


__author__ = "Romain Casati"
__license__ = "GNU GPL v3"
__email__ = "romain.casati@basthon.fr"


__all__ = ['Basthon']


class BasthonNamespace(object):
    """
    A class that acts as a namespace for Basthon methods.
    This is the part of Basthon implemented in Python that would be loaded
    in the global namspace. Code evaluation would be executed in separate
    namespace that can be cleared (this simulate the kernel restart).
    """

    class StreamManager(object):
        """
        A class to catch stderr/stdout input during eval.
        """
        def __init__(self, stream, flush_callback):
            self.stream = stream
            self.callback = flush_callback
            std = getattr(sys, stream)
            self.std = std
            self.buff = ""
            self.write_bck = std.write
            self.flush_bck = std.flush
            std.write = self.write
            std.flush = self.flush

        def __del__(self):
            self.close()

        def write(self, data):
            self.buff += data
            # using RE here could improve computation time
            if '\n' in data or '\r' in data:
                self.flush()
            return len(data)

        def flush(self):
            if not self.buff:
                return
            self.callback(self.buff)
            self.buff = ""

        def close(self):
            self.flush()
            self.std.write = self.write_bck
            self.std.flush = self.flush_bck

    def __init__(self):
        self.execution_count = None
        self._namespace = None
        self._user_modules_root = "basthon_user_modules"
        self._init_basthon_internal()
        self.start()

    def _init_basthon_internal(self):
        """ Build the basthon internal object """
        basthon = type('basthon', (object,), {})()
        basthon.__doc__ = """ This is the global Basthon namespace.
        It is used to provide usefull methods for Python in te browser.
        """

        def display(obj):
            """ Emulating the IPython.core.display.display function """
            self.display_event({'display_type': 'multiple',
                                'content': self.format_repr(obj)})

        def display_image(img):
            """ Displaying image from numpy array  """
            from matplotlib import image
            import base64
            import io

            def _repr_png_():
                raw = io.BytesIO()
                image.imsave(raw, img, format="png", cmap='gray')
                raw.seek(0)
                return base64.b64encode(raw.read()).decode()

            dummy = type('image', (), {})()
            dummy._repr_png_ = _repr_png_
            display(dummy)

        def download(filename):
            """
            Download a file from the local filesystem
            via a browser dialog.
            """
            return self.get_file(filename)

        basthon.display = display
        basthon.display_image = display_image
        basthon.download = download
        self.basthon_internal = basthon

    def start(self):
        """
        Start the Basthon kernel and fill the namespace.
        """
        basthon = self.basthon_internal

        self.execution_count = 0
        self._namespace = {
            '__name__': '__main__',
            '_': '',
            '__': '',
            '___': '',
            'In': [''],
            'Out': {},
            'display': basthon.display,
            'basthon': basthon
        }
        # todo: del sys.modules["..."]

    def stop(self):
        """
        Stop the Basthon kernel.
        """
        pass

    def restart(self):
        """
        Restart the Basthon kernel.
        """
        self.stop()
        self.start()

    def roll_in_history(self, code):
        """ Manage storing in 'In' ala IPython. """
        self._namespace['In'].append(code)

    def roll_out_history(self, out):
        """ Manage storing in 'Out', _, __, ___ ala IPython. """
        outputs = self._namespace['Out']
        # out is not always stored
        if out is not None and out is not outputs:
            outputs[self.execution_count] = out
            self._namespace['___'] = self._namespace['__']
            self._namespace['__'] = self._namespace['_']
            self._namespace['_'] = out

    def eval(self, code, data=None):
        """
        Kernel function to evaluate Python code.
        data can be accessed in code through '__eval_data__' variable
        in gobal namespace.
        """
        self._namespace['__eval_data__'] = data
        res = pyodide.eval_code(code, self._namespace)
        # This lines has been commented for p5 compatibility.
        # It seems useless to delete since later call will erase it.
        # However, if we delete it and there is asynchronous call to
        # say eval.display event (like in some p5) we are bad...
        # del self._namespace['__eval_data__']
        return res

    def format_repr(self, obj):
        res = {"text/plain": repr(obj)}
        if hasattr(obj, "_repr_html_"):
            res["text/html"] = obj._repr_html_()
        if hasattr(obj, "_repr_svg_"):
            res["image/svg+xml"] = obj._repr_svg_()
        if hasattr(obj, "_repr_png_"):
            res["image/png"] = obj._repr_png_()
        return res

    def shell_eval(self, code, stdout_callback, stderr_callback, data=None):
        """
        Evaluation of Python code with communication managment
        with the JS part of Basthon and stdout/stderr catching.
        data can be accessed in code through '__eval_data__' variable
        in global namespace.
        """
        self.execution_count += 1
        self.roll_in_history(code)

        stdout_manager = BasthonNamespace.StreamManager("stdout", stdout_callback)
        stderr_manager = BasthonNamespace.StreamManager("stderr", stderr_callback)

        try:
            _ = self.eval(code, data=data)
        except Exception:
            raise
        else:
            self.roll_out_history(_)
            if _ is not None:
                return self.format_repr(_)
        finally:
            stdout_manager.close()
            stderr_manager.close()

    def find_imports(self, code):
        """
        Wrapper around pyodide.find_imports.
        """
        if not isinstance(code, str):
            try:
                code = code.tobytes()
            except Exception:
                pass
            code = code.decode()
        return pyodide.find_imports(code)

    def micropip_install(self, packages):
        """ Load packages using micropip and returning a promise. """
        import micropip
        return micropip.install(packages)

    def importables(self):
        """ List of all importable modules. """
        import sys
        import pkgutil
        import js
        from_sys = set(x for x in sys.modules.keys() if '.' not in x)
        from_pkgutil = set(p.name for p in pkgutil.iter_modules())
        from_basthon_js = set(x for x in js.window.Basthon.packages.all if '.' not in x)
        return sorted(from_sys.union(from_pkgutil, from_basthon_js))

    def put_file(self, filepath, content):
        """
        Put a file on the (emulated) local filesystem.
        """
        dirname, _ = os.path.split(filepath)
        if dirname:
            os.makedirs(dirname, exist_ok=True)

        with open(filepath, 'wb') as f:
            f.write(content)

    def put_module(self, filename, content):
        """
        Put a module (*.py file) on the (emulated) local filesystem
        bypassing the Pyodide' single-import-issue by using separated
        directories for each module.
        https://github.com/iodide-project/pyodide/issues/737

        /!\ Warning: the dependencies loading is done on the JS side by
        basthon.js.
        """
        _, filename = os.path.split(filename)
        dirname = os.path.splitext(filename)[0]
        root = os.path.join('/', self._user_modules_root, dirname)
        self.put_file(os.path.join(root, filename), content)
        sys.path.insert(0, root)

    def get_file(self, filepath):
        """
        Download a file from the (emulated) local filesystem.
        """
        _, filename = os.path.split(filepath)
        with open(filepath, 'rb') as f:
            window.Basthon.download(f.read(), filename)

    def display_event(self, data):
        """ Dispatching eval.display event with display data. """
        display_data = {}
        # Updating display data with evaulation data.
        # get evaluation data from namespace
        eval_data = self._namespace['__eval_data__']
        if eval_data is not None:
            display_data.update(eval_data)
        display_data.update(data)
        window.Basthon.dispatchEvent("eval.display", display_data)

    def hack_matplotlib(self):
        """
        Hack the Wasm backend of matplotlib to render figures.
        """
        from matplotlib.backends.wasm_backend import FigureCanvasWasm as wasm_backend

        # preserve access to self
        this = self

        # hacking root node creation
        def create_root_element(self):
            self.root = document.createElement("div")
            return self.root

        wasm_backend.create_root_element = create_root_element

        # hacking show
        if not hasattr(wasm_backend, "_original_show"):
            wasm_backend._original_show = wasm_backend.show

        def show(self):
            res = self._original_show()
            this.display_event({"display_type": "matplotlib",
                                "content": self.root})
            return res

        show.__doc__ = wasm_backend._original_show.__doc__
        wasm_backend.show = show

    def hack_turtle(self):
        """
        Hack Turtle to render figures.
        """
        from turtle import Screen

        # preserve access to self
        this = self

        # hacking show_scene
        if not hasattr(Screen, "_original_show_scene"):
            Screen._original_show_scene = Screen.show_scene

        def show_scene(self):
            root = self._original_show_scene()
            this.display_event({"display_type": "turtle",
                                "content": root})
            self.restart()

        show_scene.__doc__ = Screen._original_show_scene.__doc__

        Screen.show_scene = show_scene

    def hack_sympy(self):
        """
        Hack Sympy to render expression using LaTeX (and probably MathJax).
        """
        import sympy

        # preserve access to self
        this = self

        def pretty_print(*args, sep=' '):
            """
            Print arguments in latex form.
            """
            latex = sep.join(sympy.latex(expr) for expr in args)
            this.display_event({"display_type": "sympy",
                                "content": "$${}$$".format(latex)})

        sympy.pretty_print = pretty_print

    def hack_folium(self):
        """
        Hack Folium to render maps.
        """
        from folium import Map

        # preserve access to self
        this = self

        def display(self):
            """
            Render map to html.
            """
            this.display_event({"display_type": "html",
                                "content": self._repr_html_()})

        Map.display = display

    def hack_pandas(self):
        """
        Hack Pandas to render data frames.
        """
        from pandas import DataFrame

        # preserve access to self
        this = self

        def display(self):
            """
            Render data frame to html.
            """
            this.display_event({"display_type": "html",
                                "content": self._repr_html_()})

        DataFrame.display = display


Basthon = BasthonNamespace()

# Basthon can be accessed via Pyodide module
pyodide.Basthon = Basthon


# hacking Pyodide bugy input function

_default_input = __builtins__.input


def _hacked_input(prompt=None):
    if prompt is not None:
        print(prompt, end='', flush=True)
    res = window.prompt(prompt)
    print(res)
    return res


# copying all writable attributes (usefull to keep docstring and name)
for a in dir(_default_input):
    try:
        setattr(_hacked_input, a, getattr(_default_input, a))
    except Exception:
        pass

# replacing
__builtins__.input = _hacked_input


# hacking help function
# see pydoc.py in cpython :
# https://github.com/python/cpython/blob/master/Lib/pydoc.py
# it uses a class called ModuleScanner to list packages.
# this class first look at sys.builtin_module_names then in pkgutil.
# we fake sys.builtin_module_names in order to get the right


_default_help = pydoc.help


def _hacked_help(*args, **kwargs):
    backup = sys.builtin_module_names
    to_add = [x for x in window.Basthon.packages.all if '.' not in x]
    to_add.append('js')
    sys.builtin_module_names = backup + tuple(to_add)
    res = _default_help(*args, **kwargs)
    sys.builtin_module_names = backup
    return res


pydoc.help = _hacked_help
