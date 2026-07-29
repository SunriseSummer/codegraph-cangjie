import type { Node as SyntaxNode } from 'web-tree-sitter';
import { getNodeText, getPrecedingDocstring } from '../tree-sitter-helpers';
import type { LanguageExtractor, ExtractorContext } from '../tree-sitter-types';

/**
 * Cangjie 1.0.5 extraction.
 *
 * The bundled grammar exposes dedicated name/body child kinds
 * (`funcName`, `classBody`, …) in addition to stable `name` fields. The
 * child-kind fallbacks intentionally remain: they make the extractor tolerant
 * of older 1.0.5 grammar artifacts while the native and WASM release assets
 * use the field-annotated parser generated in this workspace.
 */

function childOfType(node: SyntaxNode, ...types: string[]): SyntaxNode | null {
  for (let i = 0; i < node.namedChildCount; i++) {
    const child = node.namedChild(i);
    if (child && types.includes(child.type)) return child;
  }
  return null;
}

function collectBindingNames(node: SyntaxNode, source: string): string[] {
  const names: string[] = [];
  const walk = (current: SyntaxNode): void => {
    if (current.type === 'varBindingPattern') {
      const name = getNodeText(current, source).trim();
      if (name && name !== '_') names.push(name);
      return;
    }
    for (let i = 0; i < current.namedChildCount; i++) {
      const child = current.namedChild(i);
      if (child) walk(child);
    }
  };
  walk(node);
  return names;
}

function modifierText(node: SyntaxNode): string {
  return childOfType(node, 'modifiers')?.text ?? '';
}

/**
 * Cangjie annotations are macros in the grammar, so declaration annotations
 * such as `@Test`, `@TestCase`, `@BeforeEach`, and parameterized `@Test[...]`
 * appear as `macroExpression` siblings immediately before the declaration.
 * Preserve their names on the graph node's decorators list so tools can tell
 * a test function/class/case from an ordinary helper in the same `_test.cj`.
 */
function declarationMacroNames(node: SyntaxNode): string[] | undefined {
  const names: string[] = [];
  const nameOf = (macro: SyntaxNode): string | undefined => {
    const name = childOfType(macro, 'macroName');
    const text = name?.text.trim();
    return text || undefined;
  };

  // Be tolerant of grammar variants that attach macro attributes directly.
  for (let i = 0; i < node.namedChildCount; i++) {
    const child = node.namedChild(i);
    if (child?.type !== 'macroExpression') continue;
    const name = nameOf(child);
    if (name) names.push(name);
  }

  const parent = node.parent;
  if (parent) {
    let declarationIndex = -1;
    for (let i = 0; i < parent.namedChildCount; i++) {
      const sibling = parent.namedChild(i);
      if (sibling?.startIndex === node.startIndex) {
        declarationIndex = i;
        break;
      }
    }
    for (let i = declarationIndex - 1; i >= 0; i--) {
      const sibling = parent.namedChild(i);
      if (!sibling || sibling.type !== 'macroExpression') break;
      const name = nameOf(sibling);
      if (name) names.unshift(name);
    }
  }

  return names.length > 0 ? [...new Set(names)] : undefined;
}

function enclosingTypeDefinition(node: SyntaxNode): SyntaxNode | null {
  let current = node.parent;
  while (current) {
    if (
      current.type === 'classDefinition' ||
      current.type === 'interfaceDefinition' ||
      current.type === 'structDefinition' ||
      current.type === 'enumDefinition' ||
      current.type === 'extendDefinition'
    ) {
      return current;
    }
    current = current.parent;
  }
  return null;
}

/**
 * Cangjie defaults ordinary declarations to `internal`. Interface members are
 * implicitly public, while a sealed top-level type is implicitly public.
 */
function cangjieVisibility(
  node: SyntaxNode
): 'public' | 'protected' | 'private' | 'internal' {
  const modifiers = modifierText(node);
  if (/\bpublic\b/.test(modifiers) || /\bsealed\b/.test(modifiers)) return 'public';
  if (/\bprotected\b/.test(modifiers)) return 'protected';
  if (/\bprivate\b/.test(modifiers)) return 'private';
  if (/\binternal\b/.test(modifiers)) return 'internal';
  if (enclosingTypeDefinition(node)?.type === 'interfaceDefinition') return 'public';
  return 'internal';
}

function normalizeCangjieTypeName(typeText: string): string | undefined {
  let text = typeText.trim().replace(/^:\s*/, '').replace(/^[?!]+\s*/, '');
  if (!text || text.startsWith('(')) return undefined;
  text = text.replace(/<.*$/s, '').trim();
  const last = text.split('.').pop()?.trim();
  if (!last || !/^[\p{L}_][\p{L}\p{N}_]*$/u.test(last)) return undefined;
  const primitives = new Set([
    'Unit', 'Nothing', 'Bool', 'Rune', 'String',
    'Int8', 'Int16', 'Int32', 'Int64', 'IntNative',
    'UInt8', 'UInt16', 'UInt32', 'UInt64', 'UIntNative',
    'Float16', 'Float32', 'Float64',
  ]);
  return primitives.has(last) ? undefined : last;
}

function hasKeywordToken(node: SyntaxNode, keyword: string): boolean {
  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i);
    if (child && !child.isNamed && child.type === keyword) return true;
  }
  return false;
}

interface ImportEntry {
  module: string;
  alias?: string;
}

/**
 * Expand every legal Cangjie import form:
 * `a.b`, `a.b.*`, `a.b as c`, `{a.x,b.y}`, and `a.{x,y as z}`.
 */
function collectImportEntries(list: SyntaxNode, source: string): ImportEntry[] {
  const entries: ImportEntry[] = [];
  for (const packageName of list.childrenForFieldName('packageName')) {
    if (packageName) entries.push({ module: getNodeText(packageName, source) });
  }
  for (let i = 0; i < list.namedChildCount; i++) {
    const child = list.namedChild(i);
    if (!child) continue;
    if (child.type === 'packageFull') {
      const packageName = child.childForFieldName('packageName');
      if (packageName) entries.push({ module: `${getNodeText(packageName, source)}.*` });
    } else if (child.type === 'packageAlias') {
      const packageName = child.childForFieldName('packageName');
      const alias = child.childForFieldName('alias');
      if (packageName) {
        entries.push({
          module: getNodeText(packageName, source),
          alias: alias ? getNodeText(alias, source) : undefined,
        });
      }
    } else if (child.type === 'packageGroup') {
      entries.push(...collectImportEntries(child, source));
    } else if (child.type === 'subGroupOfPackage') {
      const packageName = child.childForFieldName('packageName');
      const prefix = packageName ? getNodeText(packageName, source) : '';
      const group = childOfType(child, 'packageGroup');
      if (group) {
        for (const entry of collectImportEntries(group, source)) {
          entries.push({
            module: prefix ? `${prefix}.${entry.module}` : entry.module,
            alias: entry.alias,
          });
        }
      }
    }
  }
  return entries;
}

const BODY_TYPES = [
  'block',
  'classBody',
  'interfaceBody',
  'structBody',
  'enumBody',
  'extendBody',
];

const NAME_CHILD: Record<string, string> = {
  functionDefinition: 'funcName',
  classDefinition: 'className',
  interfaceDefinition: 'interfaceName',
  structDefinition: 'structName',
  enumDefinition: 'enumName',
  typeAlias: 'typeAliasName',
  propertyDefinition: 'propertyName',
  macroDefinition: 'macroName',
};

/**
 * Return declaration type parameters, excluding generic arguments that belong
 * to a supertype or to the type being extended.
 */
function declarationTypeParameters(node: SyntaxNode): SyntaxNode | null {
  if (node.type === 'extendDefinition') {
    const extendType = childOfType(node, 'extendType');
    if (!extendType) return null;
    const targetName = childOfType(extendType, 'identifier', 'scoped_identifier');
    for (let i = 0; i < extendType.namedChildCount; i++) {
      const child = extendType.namedChild(i);
      if (
        child?.type === 'typeParameters' &&
        (!targetName || child.endIndex <= targetName.startIndex)
      ) {
        return child;
      }
    }
    return null;
  }

  const nameKind = NAME_CHILD[node.type];
  if (!nameKind) return null;
  const name = childOfType(node, nameKind);
  if (!name) return null;
  const firstSupertype = childOfType(node, 'superOrInterface');
  for (let i = 0; i < node.namedChildCount; i++) {
    const child = node.namedChild(i);
    if (
      child?.type === 'typeParameters' &&
      child.startIndex >= name.endIndex &&
      (!firstSupertype || child.endIndex <= firstSupertype.startIndex)
    ) {
      return child;
    }
  }
  return null;
}

export const cangjieExtractor: LanguageExtractor = {
  functionTypes: [
    'functionDefinition',
    'mainDefinition',
    'macroDefinition',
    'operatorFunctionDefinition',
  ],
  classTypes: ['classDefinition'],
  methodTypes: [
    'functionDefinition',
    'operatorFunctionDefinition',
    'init',
    'staticInit',
    'finalizer',
  ],
  interfaceTypes: ['interfaceDefinition'],
  structTypes: ['structDefinition'],
  enumTypes: ['enumDefinition'],
  enumMemberTypes: ['enumConstructor'],
  typeAliasTypes: ['typeAlias'],
  importTypes: ['importList'],
  callTypes: [
    'callSuffix',
    'trailingLambdaExpression',
    'binaryExpression',
    'unaryExpression',
    'indexAccess',
  ],
  variableTypes: ['variableDeclaration'],
  extraClassNodeTypes: ['extendDefinition'],
  classifyClassNode: (node) => node.type === 'extendDefinition' ? 'extension' : 'class',
  nameField: 'name',
  bodyField: 'block',
  paramsField: 'parameterList',

  resolveName: (node, source) => {
    const fieldName = node.childForFieldName('name');
    if (fieldName) return getNodeText(fieldName, source).trim();
    const nameKind = NAME_CHILD[node.type];
    if (nameKind) {
      const name = childOfType(node, nameKind);
      if (name) return getNodeText(name, source).trim();
    }
    switch (node.type) {
      case 'mainDefinition':
        return 'main';
      case 'init':
      case 'staticInit':
        return 'init';
      case 'finalizer':
        return '~init';
      case 'operatorFunctionDefinition': {
        const operator = childOfType(node, 'operator');
        return operator ? `operator${getNodeText(operator, source).trim()}` : 'operator';
      }
      case 'extendDefinition': {
        const extendType = childOfType(node, 'extendType');
        if (extendType) {
          const name = getNodeText(extendType, source).replace(/<.*$/s, '').trim();
          if (name) return name;
        }
        return getNodeText(node, source).match(
          /^\s*extend\s*(?:<[^>]*>\s*)?([\p{L}_][\p{L}\p{N}_]*)/u
        )?.[1];
      }
      default:
        return undefined;
    }
  },

  resolveBody: (node) => childOfType(node, ...BODY_TYPES),

  getSignature: (node, source) => {
    const typeParams = declarationTypeParameters(node);
    const params = childOfType(node, 'parameterList', 'primaryInitParamList');
    const returnType = childOfType(node, 'returnType');
    const constraints = childOfType(node, 'genericConstraints');
    const aliasTarget = node.type === 'typeAlias' ? node.childForFieldName('type') : null;
    if (!typeParams && !params && !returnType && !constraints && !aliasTarget) return undefined;
    const typeParamsText = typeParams ? getNodeText(typeParams, source) : '';
    const paramsText = params ? getNodeText(params, source) : '()';
    const returnText = returnType ? getNodeText(returnType, source) : '';
    const constraintText = constraints ? ` ${getNodeText(constraints, source)}` : '';
    if (aliasTarget) {
      return `${typeParamsText} = ${getNodeText(aliasTarget, source)}${constraintText}`.trim();
    }
    if (!params) return `${typeParamsText}${constraintText}`.trim() || undefined;
    return `${typeParamsText}${paramsText}${returnText}${constraintText}`;
  },

  getTypeParameters: (node, source) => {
    const params = declarationTypeParameters(node);
    if (!params) return undefined;
    const names = params.namedChildren
      .filter((child) => child.type === 'identifier')
      .map((child) => getNodeText(child, source).trim())
      .filter(Boolean);
    return names.length > 0 ? names : undefined;
  },

  getEnumMemberSignature: (node, source) => {
    if (node.type !== 'enumConstructor') return undefined;
    const payload = node.childForFieldName('payload') ?? childOfType(node, 'enumPayload');
    return payload ? getNodeText(payload, source).trim() : undefined;
  },

  getVisibility: cangjieVisibility,
  isExported: (node) => cangjieVisibility(node) === 'public',
  isStatic: (node) => node.type === 'staticInit' || /\bstatic\b/.test(modifierText(node)),
  isConst: (node) => hasKeywordToken(node, 'let') || hasKeywordToken(node, 'const'),
  extractModifiers: declarationMacroNames,

  getReturnType: (node, source) => {
    const returnType = childOfType(node, 'returnType');
    return returnType
      ? normalizeCangjieTypeName(getNodeText(returnType, source))
      : undefined;
  },

  packageTypes: ['packageDeclaration'],
  extractPackage: (node, source) => {
    const packageName = node.childForFieldName('packageName');
    return packageName ? getNodeText(packageName, source).trim() : null;
  },

  visitNode: (node: SyntaxNode, ctx: ExtractorContext): boolean => {
    const source = ctx.source;

    if (node.type === 'importList') {
      const statement = getNodeText(node, source).trim().slice(0, 120);
      const isPublic = /^\s*public\s+import\b/u.test(statement);
      const ownerId = ctx.nodeStack[ctx.nodeStack.length - 1];
      for (const entry of collectImportEntries(node, source)) {
        ctx.createNode('import', entry.module, node, {
          signature: entry.alias ? `${statement} (as ${entry.alias})` : statement,
          visibility: isPublic ? 'public' : 'internal',
          isExported: isPublic,
        });
        if (ownerId) {
          ctx.addUnresolvedReference({
            fromNodeId: ownerId,
            referenceName: entry.module.replace(/\.\*$/, ''),
            referenceKind: 'imports',
            line: node.startPosition.row + 1,
            column: node.startPosition.column,
          });
        }
      }
      return true;
    }

    // Member parameters in a primary constructor are both parameters and fields.
    if (node.type === 'primaryInit') {
      const params = childOfType(node, 'primaryInitParamList');
      if (params) {
        for (const memberParam of params.namedChildren) {
          if (
            memberParam.type !== 'unnamedMemberParam' &&
            memberParam.type !== 'namedMemeberParam' &&
            memberParam.type !== 'namedMemberParam'
          ) {
            continue;
          }
          const param = childOfType(memberParam, 'parameter', 'namedParameter');
          const name = param?.childForFieldName('paraName');
          if (!name) continue;
          const visibility = cangjieVisibility(memberParam);
          ctx.createNode('field', getNodeText(name, source).trim(), memberParam, {
            signature: getNodeText(memberParam, source).trim().slice(0, 100),
            visibility,
            isExported: visibility === 'public',
          });
        }
      }
      const visibility = cangjieVisibility(node);
      const init = ctx.createNode('method', 'init', node, {
        signature: params ? getNodeText(params, source).slice(0, 100) : undefined,
        visibility,
        isExported: visibility === 'public',
        docstring: getPrecedingDocstring(node, source),
      });
      if (init) {
        ctx.pushScope(init.id);
        ctx.visitFunctionBody(node, init.id);
        ctx.popScope();
      }
      return true;
    }

    if (node.type === 'propertyDefinition') {
      const name = node.childForFieldName('name') ?? childOfType(node, 'propertyName');
      if (!name) return false;
      const type = node.childForFieldName('type');
      const modifiers = modifierText(node);
      const visibility = cangjieVisibility(node);
      const property = ctx.createNode('property', getNodeText(name, source).trim(), node, {
        signature: type ? `: ${getNodeText(type, source).trim()}` : undefined,
        decorators: /\bmut\b/.test(modifiers) ? ['mut'] : undefined,
        isStatic: /\bstatic\b/.test(modifiers),
        isExported: visibility === 'public',
        visibility,
        docstring: getPrecedingDocstring(node, source),
      });
      if (property) {
        for (const accessor of ['getter', 'setter'] as const) {
          for (const block of node.childrenForFieldName(accessor)) {
            if (block?.type !== 'block') continue;
            ctx.pushScope(property.id);
            ctx.visitFunctionBody(block, property.id);
            ctx.popScope();
          }
        }
      }
      return true;
    }

    if (node.type === 'variableDeclaration') {
      const nameNode = node.childForFieldName('name') ?? childOfType(node, 'variableName');
      if (!nameNode) return false;
      const names = collectBindingNames(nameNode, source);
      if (names.length === 0) return true;

      const parentId = ctx.nodeStack[ctx.nodeStack.length - 1];
      const parent = parentId ? ctx.nodes.find((candidate) => candidate.id === parentId) : undefined;
      const classLike = !!parent && (
        parent.kind === 'class' ||
        parent.kind === 'struct' ||
        parent.kind === 'interface' ||
        parent.kind === 'enum' ||
        parent.kind === 'trait' ||
        parent.kind === 'module' ||
        parent.kind === 'extension'
      );
      const immutable = hasKeywordToken(node, 'let') || hasKeywordToken(node, 'const');
      const isStatic = /\bstatic\b/.test(modifierText(node));
      const kind = classLike
        ? (isStatic && immutable ? 'constant' : 'field')
        : (immutable ? 'constant' : 'variable');

      const type = node.childForFieldName('type');
      const initializer = node.childForFieldName('initilizer');
      const initializerText = initializer
        ? getNodeText(initializer, source).trim().slice(0, 80)
        : '';
      const signature = (
        (type ? `: ${getNodeText(type, source).trim()}` : '') +
        (initializerText ? ` = ${initializerText}` : '')
      ) || undefined;
      const visibility = cangjieVisibility(node);
      let first: ReturnType<ExtractorContext['createNode']> = null;
      for (const name of names) {
        const created = ctx.createNode(kind, name, node, {
          signature,
          isStatic,
          isExported: visibility === 'public',
          visibility,
          docstring: getPrecedingDocstring(node, source),
        });
        first ??= created;
      }
      // The custom hook consumes the declaration subtree; walk the initializer
      // once so calls remain attributed to the declared value.
      if (initializer && first) {
        ctx.pushScope(first.id);
        ctx.visitFunctionBody(initializer, first.id);
        ctx.popScope();
      }
      return true;
    }

    return false;
  },
};
