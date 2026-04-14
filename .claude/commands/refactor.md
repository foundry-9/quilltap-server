# refactor - Claude command to refactor the codebase

If you have not already done so, read in [CLAUDE.md](../../CLAUDE.md) for instructions on how to work in this repository.

Refactor the code in this repository to conform better to the following standards:

- Standards
  - respect encapsulation and single source of truth. If a feature requires duplicate code, consider inheritance. OOP principles
  - SRP
  - DRY
  - KISS
  - YAGNI
- Places to focus, in order (unless otherwise specified)
  - Data backend
  - API (should conform to RESTful `/api/v{version number}/{entity-type}/{id if applicable}?action={action}`
    concept, so CRUD is done with GET/POST/PUT/PATCH/DELETE as appropriate, but anything else is done using action verbs, with body usually holding the data to use in the operation
  - UI or front-end
- Specific areas to target in addition to the above
  - API conformance to standard above
  - Instead of using Tailwind classes, use `qt-*` theme utility classes, and update theme-storybook and distributed themes as appropriate
  - Find and destroy dead code
  - Security
  - For some reason the development process tends to leave stubs lying around: find TODO and other stubs and implement them properly
- Unit tests
  - Coverage should increase if possible with every change
  - Unit tests are in __tests__/unit and can be run using `npm run test:unit`
