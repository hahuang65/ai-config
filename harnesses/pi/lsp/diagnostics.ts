type Report = { items: unknown[]; versioned: boolean; source: "push" };
type Document = { version: number; report?: Report; ready?: (report: Report) => void; fail?: (error: Error) => void };

/** Retains only explicitly opened documents, and invalidates reports on each edit. */
export class Diagnostics {
  private documents = new Map<string, Document>();

  changed(uri: string, version: number) { this.documents.set(uri, { version }); }
  forget(uri: string) { this.documents.delete(uri); }

  publish(params: any) {
    const document = this.documents.get(params?.uri);
    if (!document || !Array.isArray(params.diagnostics)) return;
    if (params.version !== undefined && params.version !== document.version) return;
    const report: Report = { items: params.diagnostics, versioned: params.version !== undefined, source: "push" };
    document.report = report;
    document.ready?.(report);
  }

  read(uri: string, signal?: AbortSignal): Promise<Report> {
    const document = this.documents.get(uri);
    if (signal?.aborted) return Promise.reject(new Error("Language-server request cancelled."));
    if (!document) return Promise.reject(new Error("Document was closed."));
    if (document.report) return Promise.resolve(document.report);
    return new Promise((resolve, reject) => {
      const abort = () => finish(new Error("Language-server request cancelled."));
      const timer = setTimeout(() => finish(new Error("No diagnostics received within 3 seconds; this is not a clean result.")), 3000);
      const finish = (error?: Error, report?: Report) => {
        clearTimeout(timer);
        signal?.removeEventListener("abort", abort);
        document.ready = undefined;
        document.fail = undefined;
        if (error) reject(error); else resolve(report!);
      };
      document.ready = (report) => finish(undefined, report);
      document.fail = (error) => finish(error);
      signal?.addEventListener("abort", abort, { once: true });
    });
  }

  stop(error = new Error("Language server stopped before diagnostics arrived.")) {
    for (const document of this.documents.values()) document.fail?.(error);
    this.documents.clear();
  }
}
