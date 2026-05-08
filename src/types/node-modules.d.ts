declare module 'node-jieba' {
  function cutForSearch(text: string): string[];
  function cut(text: string): string[];
  function insertWord(word: string): void;

  export default { cutForSearch, cut, insertWord };
  export { cutForSearch, cut, insertWord };
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