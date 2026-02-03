/**
 * ESLint plugin to catch misspelling of "Quilltap" as "Quilltap"
 */

module.exports = {
  rules: {
    'no-quilltap-misspelling': {
      meta: {
        type: 'problem',
        docs: {
          description: 'Disallow misspelling of "Quilltap" as "Quilltap"',
          category: 'Possible Errors',
          recommended: true,
        },
        messages: {
          misspelled: 'Misspelled "Quilltap" detected. Did you mean "Quilltap"?',
        },
      },
      create(context) {
        return {
          Literal(node) {
            if (typeof node.value === 'string' && /Quilttap(?!ap)/.test(node.value)) {
              context.report({
                node,
                messageId: 'misspelled',
              })
            }
          },
          TemplateElement(node) {
            if (/Quilttap(?!ap)/.test(node.value.raw)) {
              context.report({
                node,
                messageId: 'misspelled',
              })
            }
          },
        }
      },
    },
  },
}
