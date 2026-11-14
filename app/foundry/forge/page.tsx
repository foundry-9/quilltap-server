import { redirect } from 'next/navigation'
import { DEFAULT_SUBSYSTEM_DEFINITIONS } from '@/lib/foundry/subsystem-defaults'

export default function Page() {
  redirect(DEFAULT_SUBSYSTEM_DEFINITIONS['forge'].href)
}
