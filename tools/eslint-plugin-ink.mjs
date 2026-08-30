/**
 * Ink lint rules for the TUI.
 *
 * Ink's constraints are runtime ones: it does not fail to compile when a
 * component breaks them, it throws (or silently mangles the terminal)
 * once the offending branch renders — which for a keyboard-driven app
 * can be a path nobody walks until a user does. These rules move the
 * three failures we can detect statically to lint time.
 *
 * The upstream option was `eslint-plugin-react-doctor`, which ships 22
 * `ink-*` rules. They are inert: enabled at `error`, they report nothing
 * against a file that violates three of them outright, under both the
 * ESLint bridge and native oxlint. Hence these.
 *
 * Every rule resolves the Ink components through the import that brought
 * them in, so a local `Box` or a renamed `Text` is judged on what it
 * actually is rather than on its name.
 */

/**
 * Maps local JSX names back to the Ink exports they were imported from,
 * so `import { Box as Row } from 'ink'` still resolves to `Box`.
 */
function inkImportTracker() {
  /** @type {Map<string, string>} */
  const localToInkName = new Map();

  return {
    collect(node) {
      if (node.source.value !== 'ink') return;
      for (const spec of node.specifiers) {
        if (spec.type !== 'ImportSpecifier') continue;
        localToInkName.set(spec.local.name, spec.imported.name);
      }
    },
    /** The Ink export a JSX element resolves to, or undefined. */
    resolve(jsxElement) {
      const name = jsxElement.openingElement?.name;
      if (name?.type !== 'JSXIdentifier') return undefined;
      return localToInkName.get(name.name);
    },
  };
}

/** Children that put literal text on screen, as opposed to components. */
function literalTextChildren(children) {
  return children.filter((child) => {
    if (child.type === 'JSXText') return child.value.trim() !== '';
    if (child.type !== 'JSXExpressionContainer') return false;
    const expr = child.expression;
    if (expr.type === 'TemplateLiteral') return true;
    return expr.type === 'Literal' && typeof expr.value !== 'boolean';
  });
}

const noRawText = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Require literal text to be wrapped in Ink <Text>, which Ink enforces at runtime by throwing.',
    },
    schema: [],
    messages: {
      rawText:
        'Text rendered directly inside <{{parent}}> crashes Ink at runtime ' +
        '("Text string must be rendered inside <Text> component"). Wrap it in <Text>.',
    },
  },
  create(context) {
    const ink = inkImportTracker();
    return {
      ImportDeclaration: ink.collect,
      JSXElement(node) {
        const parent = ink.resolve(node);
        // <Text> is the one element allowed to hold text, and
        // <Transform> exists to rewrite the text inside it.
        if (parent !== 'Box' && parent !== 'Static') return;
        for (const child of literalTextChildren(node.children)) {
          context.report({
            node: child,
            messageId: 'rawText',
            data: { parent },
          });
        }
      },
    };
  },
};

const noLayoutInsideText = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Disallow Ink layout elements inside <Text>, which Ink cannot lay out.',
    },
    schema: [],
    messages: {
      layoutInText:
        '<{{child}}> inside <Text> is not laid out by Ink — the row collapses or throws. ' +
        'Close the <Text> and nest the other way round: <Box><Text>…</Text></Box>.',
    },
  },
  create(context) {
    const ink = inkImportTracker();
    return {
      ImportDeclaration: ink.collect,
      JSXElement(node) {
        if (ink.resolve(node) !== 'Text') return;
        for (const child of node.children) {
          if (child.type !== 'JSXElement') continue;
          const childName = ink.resolve(child);
          if (childName !== 'Box' && childName !== 'Static') continue;
          context.report({
            node: child,
            messageId: 'layoutInText',
            data: { child: childName },
          });
        }
      },
    };
  },
};

const noBareProcessExit = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Disallow process.exit() in Ink components, which skips Ink’s terminal restore.',
    },
    schema: [],
    messages: {
      bareExit:
        'process.exit() from a component leaves the terminal in Ink’s raw/alternate state — ' +
        'the user gets no echo and no cursor back. Call exit() from useApp() and let Ink unmount.',
    },
  },
  create(context) {
    return {
      CallExpression(node) {
        const callee = node.callee;
        if (callee.type !== 'MemberExpression') return;
        if (callee.object.type !== 'Identifier') return;
        if (callee.object.name !== 'process') return;
        if (callee.property.type !== 'Identifier') return;
        if (callee.property.name !== 'exit') return;
        context.report({ node, messageId: 'bareExit' });
      },
    };
  },
};

export default {
  meta: { name: 'eslint-plugin-ink', version: '1.0.0' },
  rules: {
    'no-raw-text': noRawText,
    'no-layout-inside-text': noLayoutInsideText,
    'no-bare-process-exit': noBareProcessExit,
  },
};
