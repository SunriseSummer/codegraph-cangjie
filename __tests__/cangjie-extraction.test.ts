import { beforeAll, describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { extractFromSource } from '../src/extraction';
import { initGrammars, loadGrammarsForLanguages } from '../src/extraction/grammars';

const FIXTURE = path.join(__dirname, 'fixtures', 'kernel-parity', 'torture.cj');

describe('Cangjie 1.0.5 extraction', () => {
  beforeAll(async () => {
    await initGrammars();
    await loadGrammarsForLanguages(['cangjie']);
  });

  it('extracts declarations, generics, extension blocks, calls and field reads', () => {
    const source = fs.readFileSync(FIXTURE, 'utf8');
    const result = extractFromSource('src/torture.cj', source, 'cangjie');
    const find = (kind: string, name: string) =>
      result.nodes.find((node) => node.kind === kind && node.name === name);

    expect(result.errors).toEqual([]);
    expect(find('namespace', 'demo.graph')).toBeTruthy();
    expect(find('interface', 'Renderable')?.visibility).toBe('public');
    expect(find('class', 'Box')?.typeParameters).toEqual(['T']);
    expect(find('field', 'value')?.visibility).toBe('public');
    expect(find('property', 'label')?.decorators).toContain('mut');
    expect(find('enum_member', 'Ok')?.signature).toBe('(T)');
    expect(find('type_alias', 'TextBox')?.signature).toContain('Box<String>');
    expect(find('extension', 'Box')).toBeTruthy();

    const refs = result.unresolvedReferences.map(
      (ref) => `${ref.referenceKind}:${ref.referenceName}`
    );
    expect(refs).toContain('extends:Base');
    expect(refs).toContain('implements:Renderable');
    expect(refs).toContain('calls:Box');
    expect(refs).toContain('calls:Ok');
    expect(refs).toContain('calls:consume');
    expect(refs).not.toContain('calls:Ok.operator<');
    expect(refs).toContain('calls:box.render');
    expect(refs).toContain('calls:this.helper');
    expect(refs).toContain('references:box.label');
    expect(refs.filter((ref) => ref === 'calls:box.render')).toHaveLength(2);
    expect(refs.filter((ref) => ref === 'references:box.label')).toHaveLength(2);

    const calls = result.unresolvedReferences.filter(
      (ref) => ref.referenceKind === 'calls'
    );
    expect(
      calls
        .filter((ref) => ref.referenceName === 'format')
        .map((ref) => ref.candidates)
    ).toEqual([
      ['@cangjie/arity=1', '@cangjie/type:0=Int64'],
      [
        '@cangjie/arity=2',
        '@cangjie/type:0=Int64',
        '@cangjie/label:1=radix',
        '@cangjie/type:1=Int64',
      ],
      ['@cangjie/arity=1', '@cangjie/type:0=String'],
    ]);
    expect(
      calls.find((ref) => ref.referenceName === 'route')?.candidates
    ).toEqual([
      '@cangjie/arity=2',
      '@cangjie/type:0=Bool',
      '@cangjie/type:1=Function',
    ]);
    expect(
      calls
        .filter((ref) => ref.referenceName === 'selector.operator+')
        .map((ref) => ref.candidates)
    ).toEqual([
      ['@cangjie/arity=1', '@cangjie/type:0=Int64'],
      ['@cangjie/arity=1', '@cangjie/type:0=String'],
    ]);
    expect(
      result.unresolvedReferences.find(
        (ref) =>
          ref.referenceKind === 'calls' &&
          ref.referenceName === 'Ok'
      )?.candidates
    ).toEqual(['@cangjie/arity=1', '@cangjie/type:0=String']);
  });
});
