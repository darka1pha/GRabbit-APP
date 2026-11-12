import { createContext, useContext } from 'react';
import type { Language } from '../../shared/types';
import {
  en,
  fa,
  dictionaries,
  createTranslator,
  errorText,
  type MessageKey,
  type Translate,
} from '@grabbit/utils';

export { en, fa, dictionaries, createTranslator, errorText };
export type { MessageKey, Translate };

export interface I18n {
  t: Translate;
  language: Language;
  dir: 'ltr' | 'rtl';
}

export const I18nContext = createContext<I18n>({ t: createTranslator('en'), language: 'en', dir: 'ltr' });

export function useI18n(): I18n {
  return useContext(I18nContext);
}
