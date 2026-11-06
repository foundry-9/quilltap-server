import { redirect } from 'next/navigation'
import { legacyCharacterRedirectTarget } from '@/lib/navigation/legacy-character-redirect'

/** A retired spelling of the character page; see `lib/navigation/legacy-character-redirect.ts`. */
export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const { id } = await params
  redirect(legacyCharacterRedirectTarget(id, await searchParams))
}
