import { EditorView, Tooltip, ViewUpdate, PluginValue } from '@codemirror/view';
import * as LSP from 'vscode-languageserver-protocol';
import { CompletionTriggerKind, PublishDiagnosticsParams } from "vscode-languageserver-protocol";
import { CompletionContext, CompletionResult } from '@codemirror/autocomplete';
import { Transport } from '@open-rpc/client-js/build/transports/Transport';
interface LSPEventMap {
    'textDocument/publishDiagnostics': LSP.PublishDiagnosticsParams;
}
type Notification = {
    [key in keyof LSPEventMap]: {
        jsonrpc: '2.0';
        id?: null | undefined;
        method: key;
        params: LSPEventMap[key];
    };
}[keyof LSPEventMap];
declare class LanguageServerClient {
    private rootUri;
    private workspaceFolders;
    private autoClose?;
    private transport;
    private requestManager;
    private client;
    ready: boolean;
    capabilities: LSP.ServerCapabilities<any>;
    private plugins;
    initializePromise: Promise<void>;
    private clientCapabilities;
    constructor(options: LanguageServerClientOptions);
    initialize(): Promise<void>;
    close(): void;
    textDocumentDidOpen(params: LSP.DidOpenTextDocumentParams): Promise<LSP.DidOpenTextDocumentParams>;
    textDocumentDidChange(params: LSP.DidChangeTextDocumentParams): Promise<LSP.DidChangeTextDocumentParams>;
    textDocumentHover(params: LSP.HoverParams): Promise<LSP.Hover>;
    textDocumentCompletion(params: LSP.CompletionParams): Promise<LSP.CompletionList | LSP.CompletionItem[]>;
    attachPlugin(plugin: LanguageServerPlugin): void;
    detachPlugin(plugin: LanguageServerPlugin): void;
    private request;
    private notify;
    private processNotification;
}
declare class LanguageServerPlugin implements PluginValue {
    private view;
    private allowHTMLContent;
    client: LanguageServerClient;
    private documentUri;
    private languageId;
    private documentVersion;
    private changesTimeout;
    constructor(view: EditorView, allowHTMLContent: boolean);
    update({ docChanged }: ViewUpdate): void;
    destroy(): void;
    initialize({ documentText }: {
        documentText: string;
    }): Promise<void>;
    sendChange({ documentText }: {
        documentText: string;
    }): Promise<void>;
    requestDiagnostics(view: EditorView): void;
    requestHoverTooltip(view: EditorView, { line, character }: {
        line: number;
        character: number;
    }): Promise<Tooltip | null>;
    requestCompletion(context: CompletionContext, { line, character }: {
        line: number;
        character: number;
    }, { triggerKind, triggerCharacter, }: {
        triggerKind: CompletionTriggerKind;
        triggerCharacter: string | undefined;
    }): Promise<CompletionResult | null>;
    processNotification(notification: Notification): void;
    processDiagnostics(params: PublishDiagnosticsParams): void;
}
interface LanguageServerBaseOptions {
    rootUri: string | null;
    workspaceFolders: LSP.WorkspaceFolder[] | null;
    documentUri: string;
    languageId: string;
}
interface LanguageServerClientOptions extends LanguageServerBaseOptions {
    transport: Transport;
    autoClose?: boolean;
    capabilities?: LSP.ClientCapabilities;
}
interface LanguageServerOptions extends LanguageServerClientOptions {
    client?: LanguageServerClient;
    allowHTMLContent?: boolean;
}
interface LanguageServerWebsocketOptions extends LanguageServerBaseOptions {
    serverUri: `ws://${string}` | `wss://${string}`;
}
declare function languageServer(options: LanguageServerWebsocketOptions): import("@codemirror/state").Extension[];
declare function languageServerWithTransport(options: LanguageServerOptions): import("@codemirror/state").Extension[];
export { LanguageServerClient, languageServer, languageServerWithTransport };
