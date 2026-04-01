import type { FunctionLike, UnknownFunction } from 'jest-mock';

declare module 'jest-mock' {
  interface MockInstance<T extends FunctionLike = UnknownFunction> {
    mockResolvedValue(value: unknown): this;
    mockResolvedValueOnce(value: unknown): this;
    mockRejectedValue(value: unknown): this;
    mockRejectedValueOnce(value: unknown): this;
  }
}
