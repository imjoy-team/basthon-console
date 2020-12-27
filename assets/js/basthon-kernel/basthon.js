'use strict';

/**
 * Using the namespace design pattern.
 */
var Basthon = (function() {
    let that = {};

    /**
     * Where to find pyodide.js (private).
     */
    that._pyodideUrl = "https://cdn.jsdelivr.net/pyodide/v0.16.1/full/pyodide.js";

    /**
     * Dirname remove basename/filename from url.
     */
    that.dirname = function (url) {
        return url.substring(0, url.lastIndexOf("/"));
    };

    /**
     * Is Basthon loaded ?
     */
    that.loaded = false;

    /**
     * Get the URL of the current script (usefull for serving basthon.py.js)
     */
    that.urlScript = document.currentScript.src;

    /**
     * Get the URL of Basthon kernel root dir.
     */
    that.basthonRoot = that.dirname(that.urlScript);

    /**
     * A separate namespace for packages (module) managment.
     * (defined here since we need basthonRoot)
     */
    that.packages = (function () {
        let pkg = {};

        /**
         * Available packages in Pyodide.
         * :type: set
         */
        pkg.pyodide = null;

        /**
         * Packages not implemented in Pyodide but in Basthon
         * (dict pointing to Pypi or internal addresse).
         * :type: dict
         */
        pkg.internal = {
            "turtle": {
                path: that.basthonRoot + "/turtle-0.0.1-py3-none-any.whl",
            },
            "requests": {
                path: that.basthonRoot + "/requests-0.0.1-py3-none-any.whl",
            },
            "proj4py": {
                path: that.basthonRoot + "/proj4py-0.0.1-py3-none-any.whl",
                deps: ["pkg_resources"],
            },
            "folium": {
                path: "folium", // loaded from PyPi
            },
            "graphviz": {
                path: that.basthonRoot + "/graphviz-0.0.1-py3-none-any.whl",
                deps: ["pkg_resources"],
            },
            "IPython": {
                path: that.basthonRoot + "/IPython-0.0.1-py3-none-any.whl",
            },
            "p5": {
                path: that.basthonRoot + "/p5-0.0.1-py3-none-any.whl",
                deps: ["pkg_resources"],
            },
        };
        
        /**
         * Union of internal and pyodide packages.
         * :type: set
         */
        pkg.all = null;

        /**
         * Packages already loaded.
         * :type: set
         */
        pkg.loaded = null;

        /**
         * Init packages lists.
         */
        pkg.init = function () {
            pkg.pyodide = new Set(Object.keys(pyodide._module.packages.import_name_to_package_name));
            pkg.all = new Set([...pkg.pyodide, ...Object.keys(pkg.internal)]);
            pkg.loaded = new Set(); // empty (nothing loaded)
        };

        /**
         * Processing packages before loading
         * (common part of Pyodide/internal loading).
         */
        pkg._processPackagesBeforeLoad = function (packages) {
            if( typeof packages === "string" ) {
                packages = [packages];
            }
            // remove already loaded
            packages = packages.filter(p => !pkg.loaded.has(p));
            // updating loaded list
            packages.forEach(p => pkg.loaded.add(p));
            return packages
        };
        
        /**
         * Loading Pyodide packages.
         * Callback function is called on not already loaded packages.
         */
        pkg.loadPyodide = async function (packages, callback) {
            packages = pkg._processPackagesBeforeLoad(packages);
            if( packages.length === 0 ) { return; }
            // from Python name to Pyodide name
            const pyodidePackages = packages.map(
                p => pyodide._module.packages.import_name_to_package_name[p]);
            await pyodide.loadPackage(pyodidePackages);
            if(callback) {
                callback(packages);
            }
        };
        
        /**
         * Loading internal module with micropip (async).
         * Callback function is called on not already loaded packages.
         */
        pkg.loadInternal = async function (packages, callback) {
            packages = pkg._processPackagesBeforeLoad(packages);
            if( packages.length === 0 ) { return; }
            const packagesPath = packages.map(p => pkg.internal[p].path);
            await pkg.loadPyodide('micropip');
            await pyodide.globals.Basthon.micropip_install(packagesPath);
            if(callback) {
                callback(packages);
            }
        };
        
        /**
         * Loading module (internal or Pyodide).
         * Callback function is called twice.
         * First on (not already loaded) Pyodide packages,
         * then on (not already loaded) internal packages. 
         */
        pkg.load = async function (packages, callback) {
            if( typeof packages === "string" ) {
                packages = [packages];
            }
            if( packages.length === 0 ) {
                return;
            }
            const pyodidePackages = packages.filter(p => pkg.pyodide.has(p));
            const internalPackages = packages.filter(p => p in pkg.internal);
            await pkg.loadPyodide(pyodidePackages, callback);
            await pkg.loadInternal(internalPackages, callback);
        };
        
        return pkg;
    })();

    
    /**
     * Downloading data (bytes array) as filename (opening browser dialog).
     */
    that.download = function (data, filename) {
        let blob = new Blob([data], { type: "application/octet-stream" });
        let anchor = document.createElement("a");
        anchor.download = filename;
        anchor.href = window.URL.createObjectURL(blob);
        anchor.target ="_blank";
        anchor.style.display = "none"; // just to be safe!
        document.body.appendChild(anchor);
        anchor.click();
        document.body.removeChild(anchor);
    };
    
    /**
     * Dynamically load a script asynchronously.
     */
    that.loadScript = function (url) {
        return new Promise(function(resolve, reject) {
            let script = document.createElement('script');
            script.onload = resolve;
            script.onerror = reject;
            script.src = url;
            document.head.appendChild(script);
        });
    };

    /**
     * A promise that resolve once the page is loaded.
     */
    that.pageLoad = (function () {
        return new Promise(function (resolve, reject) {
            if( document.readyState === 'complete' ) {
                resolve();
            } else {
                window.addEventListener("load", function() {
                    // just to be safe
                    window.removeEventListener("load", this);
                    resolve();
                });
            }
        });
    })();

    /**
     * What to do when loaded (private).
     */
    that._onload = function() {
        that.loaded = true;
        // connecting eval to basthon.eval.request event.
        that.addEventListener("eval.request", that.evalFromEvent);
        // get the version of Python from Python
        const sys = pyodide.pyimport("sys");
        that.pythonVersion = sys.version;
        that.packages.init();
        // reading basthon.py.js from same folder than current script
        return pyodide.runPythonAsync(`import pyodide ; pyodide.eval_code(pyodide.open_url('${that.basthonRoot}/basthon.py.js').getvalue(), globals())`);
    };

    /**
     * Wrapper around XHR through a promise.
     */
    that.xhr = function (params) {
        const xhr = new XMLHttpRequest();
        xhr.open(params.method, params.url, true);
        xhr.responseType = params.responseType;
        const promise = new Promise(function(resolve, reject) {
            xhr.onload = function() {
                if( xhr.status >= 200 && xhr.status < 300 ) {
                    resolve(xhr.response);
                } else {
                    reject(xhr);
                }
            };
            xhr.onerror = function () { reject(xhr); };
        });
        // headers
        if (params.headers) {
            Object.keys(params.headers).forEach(function (key) {
                xhr.setRequestHeader(key, params.headers[key]);
            });
        }
        // data
        let data = params.data;
        if (data && typeof data === 'object') {
            data = JSON.stringify(data);
        }
        xhr.send(data);
        return promise;
    };

    /**
     * Start the Basthon kernel asynchronously.
     */
    that.load = (async function () {
        /* testing if Pyodide is installed locally */
        try {
            const url = that.basthonRoot + "/pyodide/pyodide.js";
            await that.xhr({method: "HEAD", url: url});
            that._pyodideUrl = url;
        } catch {}

        // forcing Pyodide to look at the right location for other files
        window.languagePluginUrl = that._pyodideUrl.substr(0, that._pyodideUrl.lastIndexOf('/')) + '/';
        
        // avoid conflict with requirejs and use it when available.
        try {
            if( typeof requirejs !== 'undefined' ) {
                requirejs.config({paths: {pyodide: that._pyodideUrl.slice(0, -3)}});
                await new Promise(function (resolve, reject) {
                    require(['pyodide'], resolve, reject);
                });
            } else {
                await that.loadScript(that._pyodideUrl);
            }
        } catch (error) {
            console.log(error);
            console.error("Can't load pyodide.js");
        }

        await languagePluginLoader.then(
            that._onload,
            function() { console.error("Can't load Python from Pyodide"); });
        
        // waiting until page is loaded
        await that.pageLoad;
    })();
    
    /**
     *  Ease the creation of events.
     */
    that.dispatchEvent = function (eventName, data) {
        const event = new CustomEvent("basthon." + eventName, { detail: data });
        document.dispatchEvent(event);
    };

    /**
     * Ease the event processing.
     */
    that.addEventListener = function (eventName, callback) {
        document.addEventListener(
            "basthon." + eventName,
            function (event) { callback(event.detail); });
    };

    /**
     * Find modules to import from Python codes.
     */
    that.findImports = function (code) {
        if( !that.loaded ) { return ; }
        let imports = pyodide.globals.Basthon.find_imports(code);
        // manually update internal packages dependencies
        for( const i of imports ) {
            imports = imports.concat(
                (that.packages.internal[i] || {deps: []}).deps);
        }
        return imports;
    };

    /**
     * Cloning function.
     */
    that.clone = function (obj) {
        // simple trick that is enough for our purpose.
        return JSON.parse(JSON.stringify(obj));
    };
    
    /**
     * Basthon simple code evaluation function (not async).
     */
    that.eval = function (code, data=null) {
        if( !that.loaded ) { return ; }
        return pyodide.globals.Basthon.eval(code, data);
    };

    /**
     * Load modules required by a piece o code.
     */
    that.loadDependencies = async function (code, loadPackageCallback) {
        // finding packages, loading, (hacking mpl, turtle, sympy, etc),
        const toLoad = that.findImports(code);
        return await that.packages.load(toLoad, loadPackageCallback);
    };

    /**
     * Callback function for hacking several modules before import.
     */
    that.hackPackagesCallback = function (toLoad) {
        if( toLoad.includes("matplotlib") ) {
            pyodide.globals.Basthon.hack_matplotlib();
        } else if ( toLoad.includes("turtle") ) {
            pyodide.globals.Basthon.hack_turtle();
        } else if ( toLoad.includes("sympy") ) {
            pyodide.globals.Basthon.hack_sympy();
        } else if ( toLoad.includes("folium") ) {
            pyodide.globals.Basthon.hack_folium();
        } else if ( toLoad.includes("pandas") ) {
            pyodide.globals.Basthon.hack_pandas();
        }
    };

    /**
     * Load modules required by a piece of code and and hack them.
     */
    that.loadDependenciesEvent = async function (code) {
        return that.loadDependencies(code, that.hackPackagesCallback);
    };

    /**
     * Basthon async code evaluation function.
     */
    that.evalAsync = async function (code, outCallback, errCallback,
                                     loadPackageCallback, data=null) {
        if( !that.loaded ) { return ; }
        if( typeof outCallback === 'undefined' ) {
            outCallback = function (text) { console.log(text); };
        }
        if( typeof errCallback === 'undefined' ) {
            errCallback = function (text) { console.error(text); };
        }
        // loading dependencies then running
        await that.loadDependencies(code, that.hackPackagesCallback);
        return await pyodide.globals.Basthon.shell_eval(code, outCallback, errCallback, data);
    };

    /**
     * Basthon evaluation function callback.
     * It is not used directly but through basthon.eval.request event.
     * A Python error throw basthon.eval.error event.
     * Output on stdout/stderr throw basthon.eval.output.
     * Matplotlib display throw basthon.eval.display event.
     * When computation is finished, basthon.eval.finished is thrown.
     */
    that.evalFromEvent = function (data) {
        if( !that.loaded ) { return ; }

        let stdCallback = function (std) { return function (text) {
            let dataEvent = that.clone(data);
            dataEvent.stream = std;
            dataEvent.content = text;
            that.dispatchEvent("eval.output", dataEvent);
        }};
        let outCallback = stdCallback("stdout");
        let errCallback = stdCallback("stderr");

        return that.evalAsync(data.code, outCallback, errCallback,
                              that.hackPackagesCallback, data)
            .then(
                function (result) {
                let dataEvent = that.clone(data);
                dataEvent.execution_count = that.executionCount();
                if( typeof result !== 'undefined' ) {
                    dataEvent.result = result;
                }
                that.dispatchEvent("eval.finished", dataEvent);
            },
            function (error) {
                errCallback(error.toString());
                let dataEvent = that.clone(data);
                dataEvent.error = error;
                dataEvent.execution_count = that.executionCount();
                that.dispatchEvent("eval.error", dataEvent);
            });
    };

    /**
     * Get the current execution count.
     */
    that.executionCount = function () {
        return pyodide.globals.Basthon.execution_count;
    };

    /**
     * Restart the kernel.
     */
    that.restart = function () {
        if( !that.loaded ) { return ; }
        return pyodide.globals.Basthon.restart();
    };

    /**
     * Put a file on the local (emulated) filesystem.
     */
    that.putFile = function (filename, content) {
        pyodide.globals.Basthon.put_file(filename, content);
    };

    /**
     * Put an importable module on the local (emulated) filesystem
     * and load dependencies.
     */
    that.putModule = async function (filename, content) {
        await that.loadDependencies(content, that.hackPackagesCallback);
        pyodide.globals.Basthon.put_module(filename, content);
    };

    /**
     * Put a ressource (file or *.py module) on the local (emulated)
     * filesystem. Detection is based on extension.
     */
    that.putRessource = function (filename, content) {
        const ext = filename.split('.').pop();
        if( ext === 'py' ) {
            return that.putModule(filename, content);
        } else {
            return that.putFile(filename, content);
        }
    };

    return that;
})();
