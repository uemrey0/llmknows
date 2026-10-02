export interface Options {
  retries?: number
  timeout?: number
}
export interface Row {
  id: number
}
export declare function connect(url: string, options?: Options): Client
export declare class Client {
  constructor(url: string)
  query(sql: string): Promise<Row[]>
  close(): void
}
export declare namespace utils {
  function slugify(text: string): string
}
export declare const VERSION: string
export declare enum Level {
  Debug = 0,
  Info = 1,
}
/** @deprecated use connect */
export declare function legacyConnect(url: string): Client
export declare function _internal(): void
