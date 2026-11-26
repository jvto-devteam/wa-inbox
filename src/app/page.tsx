import { redirect } from 'next/navigation'

// Root = Dashboard aplikasi. Belum masuk: middleware mengalihkan ke /login dulu.
export default function Home() {
  redirect('/dashboard')
}
