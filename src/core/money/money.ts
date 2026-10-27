import { javaRound } from '../util/decimal';

// name.abuchen.portfolio.money.Money / Quote / Values (factors only)

export const Values = {
  Amount: { factor: 100, divider: 100, precision: 2 },
  Share: { factor: 100_000_000, divider: 100_000_000, precision: 8 },
  Quote: {
    factor: 100_000_000,
    divider: 100_000_000,
    precision: 8,
    /** factor() / Values.Money.factor() */
    factorToMoney: 1_000_000,
    dividerToMoney: 1_000_000,
    precisionDeltaToMoney: 6,
  },
  Weight: { factor: 100, divider: 100, precision: 2 },
} as const;

export class MonetaryException extends Error {}

export interface Money {
  readonly currencyCode: string;
  readonly amount: number;
}

export function money(currencyCode: string, amount: number): Money {
  if (!currencyCode) throw new Error('currencyCode must not be empty');
  return { currencyCode, amount: amount + 0 };
}

export function moneyAdd(a: Money, b: Money): Money {
  if (a.currencyCode !== b.currencyCode)
    throw new MonetaryException(`Illegal addition: ${a.currencyCode} + ${b.currencyCode}`);
  return money(a.currencyCode, a.amount + b.amount);
}

export function moneySubtract(a: Money, b: Money): Money {
  if (a.currencyCode !== b.currencyCode)
    throw new MonetaryException(`Illegal subtraction: ${a.currencyCode} - ${b.currencyCode}`);
  return money(a.currencyCode, a.amount - b.amount);
}

export function moneyIsZero(m: Money): boolean {
  return m.amount === 0;
}

export function moneyAbs(m: Money): Money {
  return money(m.currencyCode, Math.abs(m.amount));
}

export function moneyMultiplyAndRound(m: Money, f: number): Money {
  return money(m.currencyCode, javaRound(m.amount * f));
}

export function moneyDivide(m: Money, divisor: number): Money {
  return money(m.currencyCode, javaRound(m.amount / divisor));
}

export function moneyEquals(a: Money | null | undefined, b: Money | null | undefined): boolean {
  if (!a || !b) return a === b;
  return a.currencyCode === b.currencyCode && a.amount === b.amount;
}

export function moneySum(currencyCode: string, items: Iterable<Money>): Money {
  let sum = 0;
  for (const m of items) {
    if (m.currencyCode !== currencyCode)
      throw new MonetaryException(`Illegal addition: ${currencyCode} + ${m.currencyCode}`);
    sum += m.amount;
  }
  return money(currencyCode, sum);
}

/** Mutable money accumulator (MutableMoney) */
export class MutableMoney {
  amount = 0;
  constructor(readonly currencyCode: string, amount = 0) {
    this.amount = amount;
  }
  static of(currencyCode: string): MutableMoney {
    return new MutableMoney(currencyCode);
  }
  static ofMoney(m: Money): MutableMoney {
    return new MutableMoney(m.currencyCode, m.amount);
  }
  add(m: Money | MutableMoney): this {
    if (m.currencyCode !== this.currencyCode) throw new MonetaryException();
    this.amount += m.amount;
    return this;
  }
  subtract(m: Money | MutableMoney): this {
    if (m.currencyCode !== this.currencyCode) throw new MonetaryException();
    this.amount -= m.amount;
    return this;
  }
  divide(divisor: number): this {
    this.amount = javaRound(this.amount / divisor);
    return this;
  }
  isZero(): boolean {
    return this.amount === 0;
  }
  toMoney(): Money {
    return money(this.currencyCode, this.amount);
  }
}

export interface Quote {
  readonly currencyCode: string;
  readonly amount: number;
}

export function quote(currencyCode: string, amount: number): Quote {
  return { currencyCode, amount: amount + 0 };
}

export function quoteToMoney(q: Quote): Money {
  return money(q.currencyCode, javaRound(q.amount / Values.Quote.dividerToMoney));
}
