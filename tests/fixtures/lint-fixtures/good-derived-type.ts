import { type Static, Type } from "@sinclair/typebox";

const FooSchema = Type.Object({ bar: Type.String() });

// OK: derived from TypeBox via Static<typeof ...>
export type Foo = Static<typeof FooSchema>;
