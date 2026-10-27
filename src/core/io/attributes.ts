// Conversion of attribute values (name.abuchen.portfolio.model.AttributeType.*Converter)

import type { AttributeType, AttributeValue, LimitPrice } from '../model';
import type { PAnyValue } from './protobufClient';

const LIMIT_PRICE_PATTERN = /^\s*(<=?|>=?)\s*(.*)\s*$/;

export function converterKind(type: AttributeType): string {
  const c = type.converterClass;
  const i = c.lastIndexOf('$');
  return i >= 0 ? c.substring(i + 1) : c.substring(c.lastIndexOf('.') + 1);
}

/** LimitPriceConverter#fromProto: operator followed by the plain long value */
function parseLimitPrice(s: string): LimitPrice | null {
  const m = LIMIT_PRICE_PATTERN.exec(s);
  if (!m) return null;
  const raw = m[2].trim();
  if (!/^-?\d+$/.test(raw)) return null;
  return { relationalOperator: m[1], value: parseInt(raw, 10) };
}

export function convertAttributeFromProto(type: AttributeType, value: PAnyValue): AttributeValue {
  switch (converterKind(type)) {
    case 'StringConverter':
    case 'ImageConverter':
    case 'BookmarkConverter':
      return value.kind === 'string' ? value.value : null;
    case 'LimitPriceConverter':
      return value.kind === 'string' ? parseLimitPrice(value.value) : null;
    case 'AmountConverter':
    case 'AmountPlainConverter':
    case 'QuoteConverter':
    case 'ShareConverter':
    case 'LongConverter':
      return value.kind === 'int64' ? value.value : null;
    case 'PercentConverter':
    case 'PercentPlainConverter':
    case 'DoubleConverter':
      return value.kind === 'double' ? value.value : null;
    case 'DateConverter':
      return value.kind === 'int64' ? value.value : null; // epoch day
    case 'BooleanConverter':
      return value.kind === 'bool' ? value.value : null;
    default:
      if (value.kind === 'string' || value.kind === 'bool' || value.kind === 'int64' || value.kind === 'double')
        return value.value;
      return null;
  }
}

export { parseLimitPrice };
