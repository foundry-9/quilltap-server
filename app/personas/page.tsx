import { redirect } from 'next/navigation';

export default function Page() {
  redirect('/aurora?filter=user-controlled');
}
