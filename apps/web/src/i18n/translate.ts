import { useTranslations } from 'next-intl';
import type { Messages, NamespaceKeys, NestedKeyOf } from 'next-intl';

/**
 * The return type of `useTranslations` for a given message namespace, so a
 * lib helper can accept the translator without re-declaring its shape.
 *
 * `NS` is constrained to the app's real message namespaces (derived from
 * `pl.json` via the `next-intl` module augmentation in `messages.d.ts`), so
 * `TranslatorFor<'catalog'>` is the fully-typed translator for that namespace.
 *
 * `typeof useTranslations<NS>` is a TypeScript 4.7 instantiation expression:
 * it instantiates the generic hook with `NS` and takes its return type.
 */
export type TranslatorFor<
  NS extends NamespaceKeys<Messages, NestedKeyOf<Messages>>,
> = ReturnType<typeof useTranslations<NS>>;
