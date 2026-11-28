declare module 'ts-ebml/dist/EBML.min.js' {
  type Element = { name: string; type: string };
  class Decoder { decode(buffer: ArrayBuffer): Element[]; }
  class Reader {
    logging: boolean;
    metadatas: Element[];
    metadataSize: number;
    duration: number;
    cues: unknown[];
    read(element: Element): void;
    stop(): void;
  }
  const tools: {
    makeMetadataSeekable(metadata: Element[], duration: number, cues: unknown[]): ArrayBuffer;
  };
  const browserBuild: { Decoder: typeof Decoder; Reader: typeof Reader; tools: typeof tools };
  export default browserBuild;
}

