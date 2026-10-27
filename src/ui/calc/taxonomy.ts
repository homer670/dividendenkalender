// TaxonomyModel (name.abuchen.portfolio.ui.views.taxonomy): actual and target values per node

import { Account, Assignment, Classification, Client, InvestmentVehicle, ONE_HUNDRED_PERCENT, Security, Taxonomy, UNASSIGNED_ID } from '../../core/model';
import { CurrencyConverter } from '../../core/money/exchange';
import { ClientSnapshot, compareText } from '../../core/snapshot/clientSnapshot';
import { javaRound } from '../../core/util/decimal';
import { LocalDate } from '../../core/util/dates';

export interface TaxonomyNode {
  key: string;
  name: string;
  color: string;
  classification: Classification | null;
  assignment: Assignment | null;
  vehicle: InvestmentVehicle | null;
  weight: number;
  rank: number;
  parent: TaxonomyNode | null;
  children: TaxonomyNode[];
  /** in cents */
  actual: number;
  target: number | null;
  isUnassigned: boolean;
}

export interface TaxonomyModelResult {
  virtualRoot: TaxonomyNode;
  classificationRoot: TaxonomyNode;
  unassigned: TaxonomyNode;
  currency: string;
  total: number;
}

let keyCounter = 0;

function node(parent: TaxonomyNode | null, init: Partial<TaxonomyNode>): TaxonomyNode {
  return {
    key: `n${keyCounter++}`,
    name: '',
    color: '#999999',
    classification: null,
    assignment: null,
    vehicle: null,
    weight: ONE_HUNDRED_PERCENT,
    rank: 0,
    parent,
    children: [],
    actual: 0,
    target: null,
    isUnassigned: false,
    ...init,
  };
}

function classificationNode(parent: TaxonomyNode | null, c: Classification): TaxonomyNode {
  return node(parent, { name: c.name, color: c.color, classification: c, weight: c.weight, rank: c.rank });
}

function visitPreOrder(n: TaxonomyNode, fn: (n: TaxonomyNode) => void): void {
  fn(n);
  for (const c of n.children) visitPreOrder(c, fn);
}

export function buildTaxonomyModel(client: Client, converter: CurrencyConverter, taxonomy: Taxonomy, date: LocalDate): TaxonomyModelResult {
  const snapshot = ClientSnapshot.create(client, converter, date);
  const virtualRoot = node(null, { name: 'Gesamtportfolio', color: taxonomy.root.color });
  const classificationRoot = classificationNode(virtualRoot, taxonomy.root);
  virtualRoot.children.push(classificationRoot);

  const stack: TaxonomyNode[] = [classificationRoot];
  while (stack.length > 0) {
    const m = stack.pop()!;
    const c = m.classification!;
    for (const child of c.children) {
      const cm = classificationNode(m, child);
      stack.push(cm);
      m.children.push(cm);
    }
    for (const a of c.assignments)
      m.children.push(
        node(m, {
          name: a.investmentVehicle.name,
          assignment: a,
          vehicle: a.investmentVehicle,
          weight: a.weight,
          rank: a.rank,
          color: m.color,
        }),
      );
    m.children.sort((o1, o2) => o1.rank - o2.rank);
  }

  const unassigned = node(virtualRoot, {
    name: 'Ohne Klassifizierung',
    color: '#cccccc',
    classification: new Classification(UNASSIGNED_ID, 'Ohne Klassifizierung', '#cccccc'),
    isUnassigned: true,
  });
  virtualRoot.children.push(unassigned);

  // addUnassigned
  const weights = new Map<InvestmentVehicle, number>();
  for (const s of client.securities) weights.set(s, 0);
  for (const a of client.accounts) weights.set(a, 0);
  visitPreOrder(virtualRoot, (n) => {
    if (!n.assignment) return;
    const v = n.assignment.investmentVehicle;
    if (weights.has(v)) weights.set(v, weights.get(v)! + n.assignment.weight);
  });
  const missing: { vehicle: InvestmentVehicle; weight: number }[] = [];
  for (const [vehicle, w] of weights) if (w < ONE_HUNDRED_PERCENT) missing.push({ vehicle, weight: ONE_HUNDRED_PERCENT - w });
  missing.sort((a, b) => compareText(a.vehicle.name, b.vehicle.name));
  for (const m of missing) {
    const a = new Assignment(m.vehicle, m.weight);
    a.rank = unassigned.children.length;
    unassigned.children.push(node(unassigned, { name: m.vehicle.name, assignment: a, vehicle: m.vehicle, weight: m.weight, rank: a.rank, color: '#cccccc' }));
  }

  // visitActuals
  const positions = snapshot.getPositionsByVehicle();
  const visitActuals = (n: TaxonomyNode): void => {
    let actual = 0;
    for (const child of n.children) {
      visitActuals(child);
      actual += child.actual;
    }
    if (n.assignment) {
      const p = positions.get(n.assignment.investmentVehicle);
      if (p) actual += javaRound((p.getValuation().amount * n.assignment.weight) / ONE_HUNDRED_PERCENT);
    }
    n.actual = actual;
  };
  visitActuals(virtualRoot);

  // RecalculateTargetsAttachedModel
  virtualRoot.target = virtualRoot.actual - unassigned.actual;
  visitPreOrder(virtualRoot, (n) => {
    if (n.classification && n.parent !== null) {
      const parentTarget = n.parent.target ?? 0;
      const direct = n.parent.children.filter((c) => c.assignment !== null).reduce((s, c) => s + c.actual, 0);
      n.target = javaRound(((parentTarget - direct) * n.weight) / ONE_HUNDRED_PERCENT);
    }
  });

  return { virtualRoot, classificationRoot, unassigned, currency: converter.termCurrency, total: virtualRoot.actual };
}

export function isSecurityNode(n: TaxonomyNode): boolean {
  return n.vehicle instanceof Security;
}

export function isAccountNode(n: TaxonomyNode): boolean {
  return n.vehicle instanceof Account;
}
