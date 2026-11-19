/**
 * Every research surface in research-kit.md §9 takes the kit, the shared
 * discipline and a research agent kind from one place, and none spells its
 * own research instructions or offers `doc_grep` beside the kit.
 *
 * @jest-environment node
 */

import fs from 'fs'
import path from 'path'

const ROOT = process.cwd()
const read = (file: string) => fs.readFileSync(path.join(ROOT, file), 'utf8')

/** The services that run a research loop, with the kit and kind each must ask for. */
const SERVICES: Array<{ file: string; kit: RegExp; kinds: string[] }> = [
  { file: 'lib/services/brahma-console/orchestrator.service.ts', kit: /researchKit: 'full'/, kinds: ["agentKind: 'inquiry'"] },
  { file: 'lib/services/brahma-console/one-shot.service.ts', kit: /researchKit: 'full'/, kinds: ["agentKind: 'inquiry'"] },
  { file: 'lib/services/atlas-lore/atlas-lore.service.ts', kit: /researchKit: (input\.searchStores \? )?'full'/, kinds: ["agentKind: 'drafting'"] },
  { file: 'lib/services/wardrobe-design/wardrobe-design.service.ts', kit: /researchKit: reach\.stores \? 'full'/, kinds: ["agentKind: 'drafting'"] },
  { file: 'lib/services/scenario-builder/scenario-builder.service.ts', kit: /researchKit: 'documents'/, kinds: ["agentKind: 'drafting'"] },
]

/** The prompts that carry the discipline. */
const PROMPTS = [
  'lib/brahma-console/system-prompt-builder.ts',
  'lib/atlas/lore-draft/prompt.ts',
  'lib/wardrobe/instruction-design/prompt.ts',
  'lib/scenario-builder/system-prompt.ts',
]

/** Research instructions the shared text replaced (§7.2); no surface may spell them again. */
const RETIRED = [
  /Search more than once/i,
  /stop once you can design with confidence/i,
  /Trial and error/i,
  /## How to research/,
]

describe('research surfaces', () => {
  it.each(SERVICES)('$file asks for the kit and a research agent kind', ({ file, kit, kinds }) => {
    const source = read(file)
    expect(source).toMatch(kit)
    for (const kind of kinds) expect(source).toContain(kind)
  })

  it.each(PROMPTS)('%s takes the discipline from lib/research/discipline and spells none of its own', (file) => {
    const source = read(file)
    expect(source).toMatch(/from '@\/lib\/research\/discipline'/)
    expect(source).toContain('researchDiscipline(')
    for (const retired of RETIRED) expect(source).not.toMatch(retired)
  })

  it.each([...SERVICES.map((s) => s.file), ...PROMPTS])('%s never names doc_grep or doc_list_files', (file) => {
    expect(read(file)).not.toMatch(/\bdoc_(grep|list_files)\b/)
  })
})
