// Load the same browser modules as the desktop HTML, using DOM doubles.
const { readFileSync } = require('node:fs');
const vm = require('node:vm');
const { fileURLToPath, pathToFileURL } = require('node:url');
const { resolve } = require('node:path');
async function renderer(hq = { read: () => new Promise(() => { }) }) {
    class Element {
        constructor() {
            this.value = '';
            this.innerHTML = '';
            this.hidden = false;
            this.disabled = false;
            this.open = false;
            this.dataset = {};
            this.listeners = {};
            this.children = [];
            this.attributes = {};
            this.width = 226;
            this.style = {
                properties: {},
                setProperty(name, value) {
                    this.properties[name] = value;
                },
            };
            this.classList = { toggle() { }, add() { }, remove() { } };
        }
        addEventListener(type, listener) {
            (this.listeners[type] ??= []).push(listener);
        }
        dispatch(type, event = {}) {
            for (const listener of this.listeners[type] ?? [])
                listener(event);
        }
        async dispatchAsync(type, event = {}) {
            for (const listener of this.listeners[type] ?? [])
                await listener(event);
        }
        replaceChildren(...children) {
            this.children = children;
            this.value = children[0]?.value ?? '';
        }
        setAttribute(name, value) {
            this.attributes[name] = value;
        }
        focus() { }
        showModal() {
            this.open = true;
        }
        close() {
            this.open = false;
        }
        getBoundingClientRect() {
            return { width: this.width };
        }
        setPointerCapture(id) {
            this.capturedPointer = id;
        }
        hasPointerCapture(id) {
            return this.capturedPointer === id;
        }
        releasePointerCapture() {
            this.capturedPointer = null;
        }
        querySelector() {
            return null;
        }
        closest() {
            return this;
        }
    }
    const nodes = new Map();
    const handlers = {};
    let tick;
    const document = {
        body: new Element(),
        activeElement: null,
        openDialog: false,
        querySelector(selector) {
            if (selector === 'dialog[open]')
                return this.openDialog ? {} : null;
            if (!nodes.has(selector))
                nodes.set(selector, new Element());
            return nodes.get(selector);
        },
        addEventListener(type, handler) {
            (handlers[type] ??= []).push(handler);
        }
    };
    const click = (action, id) => {
        const target = new Element();
        target.dataset.action = action;
        if (id !== undefined)
            target.dataset.id = String(id);
        for (const handler of handlers.click ?? [])
            handler({ target });
    };
    class Option {
        constructor(text, value) {
            this.text = text;
            this.value = value;
        }
    }
    const context = {
        document,
        Option,
        Element,
        HTMLInputElement: Element,
        HTMLTextAreaElement: Element,
        HTMLSelectElement: Element,
        HTMLFormElement: Element,
        getComputedStyle: element => ({ getPropertyValue: name => element.style.properties[name] ?? '226px' }),
        window: {
            hq,
            clearTimeout() { },
            setTimeout() {
                return 0;
            },
            addEventListener() { },
            setInterval(callback) {
                tick = callback;
            }
        },
        console
    };
    vm.createContext(context);
    const html = readFileSync('ui/index.html', 'utf8');
    const [, source] = html.match(/<script type="module" src="([^"]+)"><\/script>/);
    const entry = new URL(source, pathToFileURL(resolve('ui/index.html'))).href;
    const modules = new Map();
    function loadModule(identifier) {
        if (!modules.has(identifier)) {
            const code = readFileSync(fileURLToPath(identifier), 'utf8');
            const testHooks = identifier === entry ? `
                globalThis.testApi = {
                    taskRow, taskPanel, render, showView,
                    openEditor: entryEditor.open,
                    openDeleteDialog: entryEditor.openDelete,
                    setTab: value => { activeTab = value; },
                    selectTask: id => { selectedTaskId = id; renderDetails(); },
                    setWorkspace: value => { workspace = { releases: [], ...value }; },
                    getWorkspace: () => workspace,
                };
            ` : '';
            modules.set(identifier, new vm.SourceTextModule(code + testHooks, { context, identifier }));
        }
        return modules.get(identifier);
    }
    const entryModule = loadModule(entry);
    await entryModule.link((specifier, parent) => loadModule(new URL(specifier, parent.identifier).href));
    await entryModule.evaluate();
    const change = async (target) => {
        for (const handler of handlers.change ?? [])
            await handler({ target });
    };
    const submit = async (target) => {
        for (const handler of handlers.submit ?? [])
            await handler({ target, preventDefault() { } });
    };
    return {
        api: context.testApi,
        submit,
        node: selector => document.querySelector(selector),
        click,
        change,
        tick: () => tick(),
        document
    };
}
module.exports = { renderer };
