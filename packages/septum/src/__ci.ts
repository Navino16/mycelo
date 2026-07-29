function d<T>(t: T, _c: ClassMethodDecoratorContext): T { return t }
export class S { @d p(): string { return 'x' } }
