import { BadRequestException } from '@nestjs/common';

export type EditorJsBlock = {
  id?: string;
  type: string;
  data: Record<string, unknown>;
};

export type EditorJsDocument = {
  time?: number;
  version?: string;
  blocks: EditorJsBlock[];
};

export type LocalizedEditorDocumentMap = Record<string, EditorJsDocument>;

export function parseLocalizedEditorDocumentMap(
  value: unknown,
  fieldName: string,
): LocalizedEditorDocumentMap | undefined {
  if (value == null) return undefined;

  if (!isRecord(value)) {
    throw new BadRequestException(
      `${fieldName} must be an object map of locale to Editor.js data`,
    );
  }

  const result: LocalizedEditorDocumentMap = {};

  for (const [rawLocale, rawDocument] of Object.entries(value)) {
    const locale = normalizeLocale(rawLocale);
    if (!isLocaleKey(locale)) {
      throw new BadRequestException(
        `${fieldName} contains invalid locale key: ${rawLocale}`,
      );
    }

    const document = parseEditorDocumentInput(rawDocument, `${fieldName}.${rawLocale}`);
    if (!hasContent(document)) {
      throw new BadRequestException(
        `${fieldName} values must contain at least one non-empty block`,
      );
    }

    result[locale] = document;
  }

  return result;
}

export function normalizeStoredLocalizedEditorDocumentMap(
  value: unknown,
): LocalizedEditorDocumentMap | undefined {
  if (!isRecord(value)) return undefined;

  const result: LocalizedEditorDocumentMap = {};

  for (const [rawLocale, rawDocument] of Object.entries(value)) {
    const locale = normalizeLocale(rawLocale);
    if (!isLocaleKey(locale)) continue;

    const document = tryParseEditorDocumentInput(rawDocument);
    if (!document || !hasContent(document)) continue;

    result[locale] = document;
  }

  return Object.keys(result).length > 0 ? result : undefined;
}

export function resolveLocalizedEditorDocument(
  localized: unknown,
  locale: string | undefined,
  fallbackLocale = 'en',
): EditorJsDocument | undefined {
  const normalized = normalizeStoredLocalizedEditorDocumentMap(localized);
  if (!normalized) return undefined;

  const normalizedLocale = locale ? normalizeLocale(locale) : undefined;

  if (normalizedLocale) {
    const exact = normalized[normalizedLocale];
    if (exact) return exact;

    const baseLanguage = normalizedLocale.split('-')[0];
    if (baseLanguage && normalized[baseLanguage]) {
      return normalized[baseLanguage];
    }
  }

  const fallback = normalized[normalizeLocale(fallbackLocale)];
  if (fallback) return fallback;

  return Object.values(normalized)[0];
}

export function editorDocumentToPlainText(document: EditorJsDocument): string {
  const chunks: string[] = [];

  for (const block of document.blocks) {
    const blockText = collectPlainText(block.data);
    if (blockText) {
      chunks.push(blockText);
    }
  }

  return chunks.join('\n').trim();
}

function parseEditorDocumentInput(
  value: unknown,
  fieldName: string,
): EditorJsDocument {
  if (typeof value === 'string') {
    const text = value.trim();
    if (!text) {
      throw new BadRequestException(`${fieldName} must be non-empty`);
    }
    return textToEditorDocument(text);
  }

  if (!isRecord(value)) {
    throw new BadRequestException(
      `${fieldName} must be Editor.js data or a plain text string`,
    );
  }

  const blocksRaw = value.blocks;
  if (!Array.isArray(blocksRaw)) {
    throw new BadRequestException(`${fieldName}.blocks must be an array`);
  }

  const blocks: EditorJsBlock[] = blocksRaw.map((rawBlock, index) => {
    if (!isRecord(rawBlock)) {
      throw new BadRequestException(
        `${fieldName}.blocks[${index}] must be an object`,
      );
    }

    const type = rawBlock.type;
    const data = rawBlock.data;

    if (typeof type !== 'string' || !type.trim()) {
      throw new BadRequestException(
        `${fieldName}.blocks[${index}].type must be a non-empty string`,
      );
    }

    if (!isRecord(data)) {
      throw new BadRequestException(
        `${fieldName}.blocks[${index}].data must be an object`,
      );
    }

    const id = rawBlock.id;

    return {
      ...(typeof id === 'string' && id.trim() ? { id } : {}),
      type,
      data,
    };
  });

  return {
    ...(typeof value.time === 'number' ? { time: value.time } : {}),
    ...(typeof value.version === 'string' ? { version: value.version } : {}),
    blocks,
  };
}

function tryParseEditorDocumentInput(value: unknown): EditorJsDocument | undefined {
  try {
    return parseEditorDocumentInput(value, 'descriptionLocalized');
  } catch {
    return undefined;
  }
}

function textToEditorDocument(text: string): EditorJsDocument {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const blocks = (lines.length > 0 ? lines : [text.trim()]).map((line) => ({
    type: 'paragraph',
    data: {
      text: line,
    },
  }));

  return {
    blocks,
    version: '2.29.1',
  };
}

function hasContent(document: EditorJsDocument): boolean {
  return editorDocumentToPlainText(document).length > 0;
}

function collectPlainText(value: unknown): string {
  if (typeof value === 'string') {
    return value.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }

  if (Array.isArray(value)) {
    return value
      .map((item) => collectPlainText(item))
      .filter(Boolean)
      .join(' ')
      .trim();
  }

  if (!isRecord(value)) {
    return '';
  }

  return Object.values(value)
    .map((item) => collectPlainText(item))
    .filter(Boolean)
    .join(' ')
    .trim();
}

function isRecord(value: unknown): value is Record<string, any> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normalizeLocale(locale: string): string {
  return locale.trim().toLowerCase().replace(/_/g, '-');
}

function isLocaleKey(locale: string): boolean {
  return /^[a-z]{2,3}(-[a-z0-9]{2,8})*$/.test(locale);
}
