"use strict";

window.editor = (function () {
    let that = window.ace.edit("editor");
    
    /**
     * Initialize the editor's content.
     */
    that.loadScript = async function () {
        /* set script from:
           -> query string if submited
           -> local storage if available
           -> default otherwise
        */
        const url = new URL(window.location.href);
        const script_key = 'script';
        const from_key = 'from';
        if( url.searchParams.has(script_key) ) {
            let script = url.searchParams.get(script_key);
            try {
                script = pako.inflate(Base64.toUint8Array(script),
                                      { to: 'string' });
            } catch {
                /* backward compatibility with non compressed param */
                script = decodeURIComponent(script);
            }
            that.setContent(script);
        } else if( url.searchParams.has(from_key) ) {
            let fileURL = url.searchParams.get(from_key);
            fileURL = decodeURIComponent(fileURL);
            let script;
            try {
                script = await Basthon.xhr({url: fileURL,
                                            method: 'GET'});
            } catch {
                throw {message: "Le chargement du script " + fileURL
                       + " a échoué.",
                       name: 'LoadingException'};
            }
            if( script ) {
                that.setContent(script);
            }
        } else if( (typeof(localStorage) !== "undefined") && "py_src" in localStorage) {
            that.setContent(localStorage.py_src);
        } else {
            that.setContent('for i in range(10):\n\tprint(i)');
        }
        
        that.scrollToRow(0);
        that.gotoLine(0);
    };

    /**
     * Initialize the Ace editor.
     */
    that.init = async function () {
        that.session.setMode("ace/mode/python");
        that.focus();
        
        that.setOptions({
            'enableLiveAutocompletion': true,
            'highlightActiveLine': false,
            'highlightSelectedWord': true,
            'fontSize': '12pt',
        });
        
        await that.loadScript();
    };

    /**
     * Downloading editor content as filename.
     */
    that.download = function (filename="script.py") {
        let code = that.getValue();
        code = code.replace(/\r\n|\r|\n/g, "\r\n"); // To retain the Line breaks.
        let blob = new Blob([code], { type: "text/plain" });
        let anchor = document.createElement("a");
        anchor.download = filename;
        anchor.href = window.URL.createObjectURL(blob);
        anchor.target = "_blank";
        anchor.style.display = "none"; // just to be safe!
        document.body.appendChild(anchor);
        anchor.click();
        document.body.removeChild(anchor);
    };

    /**
     * Set editor content (undo selection).
     */
    that.setContent = function (content) {
        that.setValue(content);
        that.scrollToRow(0);
        that.gotoLine(0);
    };

    /**
     * Opening file (async) and loading it in the editor.
     */
    that.open = function (file) {
        return new Promise(function (resolve, reject) {
            const reader = new FileReader();
            reader.readAsText(file);
            reader.onload = function (event) {
                that.setContent(event.target.result);
                resolve();
            };
            reader.onerror = reject;
        });
    };

    /**
     * Returning the sharing link for the code in the editor.
     */
    that.sharingURL = function() {
        // to retain the Line breaks.
        const code = that.getValue().replace(/\r\n|\r|\n/g, "\r\n");
        const url = new URL(window.location.href);
        url.hash = "";
        url.searchParams.delete("from"); // take care of collapsing params
        let script;
        try {
            script = Base64.fromUint8Array(pako.deflate(code), true);
        } catch {
            script = encodeURIComponent(code).replace(/\(/g, '%28').replace(/\)/g, '%29');
        }
        url.searchParams.set('script', script);
        return url.href;
    };

    /**
     * Backup to local storage.
     */
    that.backup = async function() {
        if (typeof(localStorage) !== "undefined") {
            localStorage.py_src = that.getValue();
        }
    };
    
    return that;
})();
