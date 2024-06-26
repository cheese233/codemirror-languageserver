import { autocompletion } from '@codemirror/autocomplete';
import { setDiagnostics } from '@codemirror/lint';
import { Facet } from '@codemirror/state';
import { ViewPlugin, hoverTooltip } from '@codemirror/view';
import { RequestManager, Client, WebSocketTransport } from '@open-rpc/client-js';
import { CompletionItemKind, CompletionTriggerKind, DiagnosticSeverity } from 'vscode-languageserver-protocol';

const timeout = 10000;
const changesDelay = 500;
const CompletionItemKindMap = Object.fromEntries(Object.entries(CompletionItemKind).map(([key, value]) => [value, key]));
const useLast = (values) => values.reduce((_, v) => v, '');
const client = Facet.define({
    combine: useLast,
});
const documentUri = Facet.define({ combine: useLast });
const languageId = Facet.define({ combine: useLast });
class LanguageServerClient {
    constructor(options) {
        this.rootUri = options.rootUri;
        this.workspaceFolders = options.workspaceFolders;
        this.autoClose = options.autoClose;
        this.plugins = [];
        this.transport = options.transport;
        this.clientCapabilities = Object.assign({
            textDocument: {
                hover: {
                    dynamicRegistration: true,
                    contentFormat: ['plaintext', 'markdown'],
                },
                moniker: {},
                synchronization: {
                    dynamicRegistration: true,
                    willSave: false,
                    didSave: false,
                    willSaveWaitUntil: false,
                },
                completion: {
                    dynamicRegistration: true,
                    completionItem: {
                        snippetSupport: false,
                        commitCharactersSupport: true,
                        documentationFormat: ['plaintext', 'markdown'],
                        deprecatedSupport: false,
                        preselectSupport: false,
                    },
                    contextSupport: false,
                },
                signatureHelp: {
                    dynamicRegistration: true,
                    signatureInformation: {
                        documentationFormat: ['plaintext', 'markdown'],
                    },
                },
                declaration: {
                    dynamicRegistration: true,
                    linkSupport: true,
                },
                definition: {
                    dynamicRegistration: true,
                    linkSupport: true,
                },
                typeDefinition: {
                    dynamicRegistration: true,
                    linkSupport: true,
                },
                implementation: {
                    dynamicRegistration: true,
                    linkSupport: true,
                },
            },
            workspace: {
                didChangeConfiguration: {
                    dynamicRegistration: true,
                },
            },
        }, options.capabilities);
        this.requestManager = new RequestManager([this.transport]);
        this.client = new Client(this.requestManager);
        this.client.onNotification((data) => {
            this.processNotification(data);
        });
        const webSocketTransport = this.transport;
        if (webSocketTransport && webSocketTransport.connection) {
            // XXX(hjr265): Need a better way to do this. Relevant issue:
            // https://github.com/FurqanSoftware/codemirror-languageserver/issues/9
            webSocketTransport.connection.addEventListener('message', (message) => {
                const data = JSON.parse(message.data);
                if (data.method && data.id) {
                    webSocketTransport.connection.send(JSON.stringify({
                        jsonrpc: '2.0',
                        id: data.id,
                        result: null,
                    }));
                }
            });
        }
        this.initializePromise = this.initialize();
    }
    async initialize() {
        const { capabilities } = await this.request('initialize', {
            capabilities: this.clientCapabilities,
            initializationOptions: null,
            processId: null,
            rootUri: this.rootUri,
            workspaceFolders: this.workspaceFolders,
        }, timeout * 3);
        this.capabilities = capabilities;
        this.notify('initialized', {});
        this.ready = true;
    }
    close() {
        this.client.close();
    }
    textDocumentDidOpen(params) {
        return this.notify('textDocument/didOpen', params);
    }
    textDocumentDidChange(params) {
        return this.notify('textDocument/didChange', params);
    }
    async textDocumentHover(params) {
        return await this.request('textDocument/hover', params, timeout);
    }
    async textDocumentCompletion(params) {
        return await this.request('textDocument/completion', params, timeout);
    }
    attachPlugin(plugin) {
        this.plugins.push(plugin);
    }
    detachPlugin(plugin) {
        const i = this.plugins.indexOf(plugin);
        if (i === -1)
            return;
        this.plugins.splice(i, 1);
        if (this.autoClose)
            this.close();
    }
    request(method, params, timeout) {
        return this.client.request({ method, params }, timeout);
    }
    notify(method, params) {
        return this.client.notify({ method, params });
    }
    processNotification(notification) {
        for (const plugin of this.plugins)
            plugin.processNotification(notification);
    }
}
class LanguageServerPlugin {
    constructor(view, allowHTMLContent) {
        this.view = view;
        this.allowHTMLContent = allowHTMLContent;
        this.client = this.view.state.facet(client);
        this.documentUri = this.view.state.facet(documentUri);
        this.languageId = this.view.state.facet(languageId);
        this.documentVersion = 0;
        this.changesTimeout = 0;
        this.client.attachPlugin(this);
        this.initialize({
            documentText: this.view.state.doc.toString(),
        });
    }
    update({ docChanged }) {
        if (!docChanged)
            return;
        if (this.changesTimeout)
            clearTimeout(this.changesTimeout);
        this.changesTimeout = self.setTimeout(() => {
            this.sendChange({
                documentText: this.view.state.doc.toString(),
            });
        }, changesDelay);
    }
    destroy() {
        this.client.detachPlugin(this);
    }
    async initialize({ documentText }) {
        if (this.client.initializePromise) {
            await this.client.initializePromise;
        }
        this.client.textDocumentDidOpen({
            textDocument: {
                uri: this.documentUri,
                languageId: this.languageId,
                text: documentText,
                version: this.documentVersion,
            },
        });
    }
    async sendChange({ documentText }) {
        if (!this.client.ready)
            return;
        try {
            await this.client.textDocumentDidChange({
                textDocument: {
                    uri: this.documentUri,
                    version: this.documentVersion++,
                },
                contentChanges: [{ text: documentText }],
            });
        }
        catch (e) {
            console.error(e);
        }
    }
    requestDiagnostics(view) {
        this.sendChange({ documentText: view.state.doc.toString() });
    }
    async requestHoverTooltip(view, { line, character }) {
        if (!this.client.ready || !this.client.capabilities.hoverProvider)
            return null;
        this.sendChange({ documentText: view.state.doc.toString() });
        const result = await this.client.textDocumentHover({
            textDocument: { uri: this.documentUri },
            position: { line, character },
        });
        if (!result)
            return null;
        const { contents, range } = result;
        let pos = posToOffset(view.state.doc, { line, character });
        let end;
        if (range) {
            pos = posToOffset(view.state.doc, range.start);
            end = posToOffset(view.state.doc, range.end);
        }
        if (pos === null)
            return null;
        const dom = document.createElement('div');
        dom.classList.add('documentation');
        if (this.allowHTMLContent)
            dom.innerHTML = formatContents(contents);
        else
            dom.textContent = formatContents(contents);
        return { pos, end, create: (view) => ({ dom }), above: true };
    }
    async requestCompletion(context, { line, character }, { triggerKind, triggerCharacter, }) {
        if (!this.client.ready || !this.client.capabilities.completionProvider)
            return null;
        this.sendChange({
            documentText: context.state.doc.toString(),
        });
        const result = await this.client.textDocumentCompletion({
            textDocument: { uri: this.documentUri },
            position: { line, character },
            context: {
                triggerKind,
                triggerCharacter,
            },
        });
        if (!result)
            return null;
        const items = 'items' in result ? result.items : result;
        let options = items.map(({ detail, label, kind, textEdit, documentation, sortText, filterText, }) => {
            var _a;
            const completion = {
                label,
                detail,
                apply: (_a = textEdit === null || textEdit === void 0 ? void 0 : textEdit.newText) !== null && _a !== void 0 ? _a : label,
                type: kind && CompletionItemKindMap[kind].toLowerCase(),
                sortText: sortText !== null && sortText !== void 0 ? sortText : label,
                filterText: filterText !== null && filterText !== void 0 ? filterText : label,
            };
            if (documentation) {
                completion.info = formatContents(documentation);
            }
            return completion;
        });
        const [span, match] = prefixMatch(options);
        const token = context.matchBefore(match);
        let { pos } = context;
        if (token) {
            pos = token.from;
            const word = token.text.toLowerCase();
            if (/^\w+$/.test(word)) {
                options = options
                    .filter(({ filterText }) => filterText.toLowerCase().startsWith(word))
                    .sort(({ apply: a }, { apply: b }) => {
                    switch (true) {
                        case a.startsWith(token.text) &&
                            !b.startsWith(token.text):
                            return -1;
                        case !a.startsWith(token.text) &&
                            b.startsWith(token.text):
                            return 1;
                    }
                    return 0;
                });
            }
        }
        return {
            from: pos,
            options,
        };
    }
    processNotification(notification) {
        try {
            switch (notification.method) {
                case 'textDocument/publishDiagnostics':
                    this.processDiagnostics(notification.params);
            }
        }
        catch (error) {
            console.error(error);
        }
    }
    processDiagnostics(params) {
        if (params.uri !== this.documentUri)
            return;
        const diagnostics = params.diagnostics
            .map(({ range, message, severity }) => ({
            from: posToOffset(this.view.state.doc, range.start),
            to: posToOffset(this.view.state.doc, range.end),
            severity: {
                [DiagnosticSeverity.Error]: 'error',
                [DiagnosticSeverity.Warning]: 'warning',
                [DiagnosticSeverity.Information]: 'info',
                [DiagnosticSeverity.Hint]: 'info',
            }[severity],
            message,
        }))
            .filter(({ from, to }) => from !== null &&
            to !== null &&
            from !== undefined &&
            to !== undefined)
            .sort((a, b) => {
            switch (true) {
                case a.from < b.from:
                    return -1;
                case a.from > b.from:
                    return 1;
            }
            return 0;
        });
        this.view.dispatch(setDiagnostics(this.view.state, diagnostics));
    }
}
function languageServer(options) {
    const serverUri = options.serverUri;
    delete options.serverUri;
    return languageServerWithTransport({
        ...options,
        transport: new WebSocketTransport(serverUri),
    });
}
function languageServerWithTransport(options) {
    let plugin = null;
    return [
        client.of(options.client ||
            new LanguageServerClient({ ...options, autoClose: true })),
        documentUri.of(options.documentUri),
        languageId.of(options.languageId),
        ViewPlugin.define((view) => (plugin = new LanguageServerPlugin(view, options.allowHTMLContent))),
        hoverTooltip((view, pos) => {
            var _a;
            return (_a = plugin === null || plugin === void 0 ? void 0 : plugin.requestHoverTooltip(view, offsetToPos(view.state.doc, pos))) !== null && _a !== void 0 ? _a : null;
        }),
        autocompletion({
            override: [
                async (context) => {
                    var _a, _b, _c;
                    if (plugin == null)
                        return null;
                    const { state, pos, explicit } = context;
                    const line = state.doc.lineAt(pos);
                    let trigKind = CompletionTriggerKind.Invoked;
                    let trigChar;
                    if (!explicit &&
                        ((_c = (_b = (_a = plugin.client.capabilities) === null || _a === void 0 ? void 0 : _a.completionProvider) === null || _b === void 0 ? void 0 : _b.triggerCharacters) === null || _c === void 0 ? void 0 : _c.includes(line.text[pos - line.from - 1]))) {
                        trigKind = CompletionTriggerKind.TriggerCharacter;
                        trigChar = line.text[pos - line.from - 1];
                    }
                    if (trigKind === CompletionTriggerKind.Invoked &&
                        !context.matchBefore(/\w+$/)) {
                        return null;
                    }
                    return await plugin.requestCompletion(context, offsetToPos(state.doc, pos), {
                        triggerKind: trigKind,
                        triggerCharacter: trigChar,
                    });
                },
            ],
        }),
    ];
}
function posToOffset(doc, pos) {
    if (pos.line >= doc.lines)
        return;
    const offset = doc.line(pos.line + 1).from + pos.character;
    if (offset > doc.length)
        return;
    return offset;
}
function offsetToPos(doc, offset) {
    const line = doc.lineAt(offset);
    return {
        line: line.number - 1,
        character: offset - line.from,
    };
}
function formatContents(contents) {
    if (Array.isArray(contents)) {
        return contents.map((c) => formatContents(c) + '\n\n').join('');
    }
    else if (typeof contents === 'string') {
        return contents;
    }
    else {
        return contents.value;
    }
}
function toSet(chars) {
    let preamble = '';
    let flat = Array.from(chars).join('');
    const words = /\w/.test(flat);
    if (words) {
        preamble += '\\w';
        flat = flat.replace(/\w/g, '');
    }
    return `[${preamble}${flat.replace(/[^\w\s]/g, '\\$&')}]`;
}
function prefixMatch(options) {
    const first = new Set();
    const rest = new Set();
    for (const { apply } of options) {
        const [initial, ...restStr] = apply;
        first.add(initial);
        for (const char of restStr) {
            rest.add(char);
        }
    }
    const source = toSet(first) + toSet(rest) + '*$';
    return [new RegExp('^' + source), new RegExp(source)];
}

export { LanguageServerClient, languageServer, languageServerWithTransport };
