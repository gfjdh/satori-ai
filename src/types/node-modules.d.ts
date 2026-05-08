declare module 'nodejieba' {
  function cutForSearch(text: string): string[];
  function cut(text: string): string[];
  function insertWord(word: string): void;

  export default { cutForSearch, cut, insertWord };
  export { cutForSearch, cut, insertWord };
}

declare module 'node-jieba' {
  // node-jieba is an older wrapper, use nodejieba instead
  const jieba: {
    cutForSearch: (text: string) => string[];
    cut: (text: string) => string[];
    insertWord: (word: string) => void;
  };
  export default jieba;
}

declare module '@xenova/transformers' {
  export function pipeline(task: string, model?: string): Promise<any>;

  export const env: {
    allowLocalModels: boolean;
    useBrowserCache: boolean;
    backends: {
      onnx: {
        wasm: {
          numThreads: number;
        };
      };
    };
  };
}