/**
 * ESLint plugin to catch misspelling of "Quilltap" as "Quilttap" (any capitalization)
 */

module.exports = {
  rules: {
    'no-quilltap-misspelling': {
      meta: {
        type: 'problem',
        docs: {
          // eslint-disable-next-line quilltap/no-quilltap-misspelling
          description: 'Disallow misspelling of "Quilltap" as "Quilttap" in any capitalization',
          category: 'Possible Errors',
          recommended: true,
        },
        messages: {
          // eslint-disable-next-line quilltap/no-quilltap-misspelling
          misspelled: 'Misspelled "Quilttap" detected. Did you mean "Quilltap"?',
        },
      },
      create(context) {
        return {
          Literal(node) {
            if (typeof node.value === 'string' && /quilttap(?!ap)/i.test(node.value)) {
              context.report({
                node,
                messageId: 'misspelled',
              })
            }
          },
          TemplateElement(node) {
            if (/quilttap(?!ap)/i.test(node.value.raw)) {
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
