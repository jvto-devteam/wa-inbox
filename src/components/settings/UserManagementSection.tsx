'use client'
import { useEffect, useState } from 'react'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table'

type Account = { id: string; name: string; email: string; role: 'ADMIN' | 'AGENT' }

export function UserManagementSection() {
  const [accounts, setAccounts] = useState<Account[]>([])
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [role, setRole] = useState<'ADMIN' | 'AGENT'>('AGENT')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  function loadAccounts() {
    return fetch('/api/accounts')
      .then((r) => r.json())
      .then(setAccounts)
  }

  useEffect(() => {
    loadAccounts()
  }, [])

  // Mirrors RemindersSection/NotesSection: only ever show what the server
  // confirmed — no optimistic update. The new account only appears once
  // loadAccounts() re-fetches after a successful POST.
  async function addAccount() {
    setError(null)
    setSubmitting(true)
    try {
      const res = await fetch('/api/accounts', {
        method: 'POST',
        body: JSON.stringify({ name, email, password, role }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        setError(body.error ?? 'Gagal menambahkan akun')
        return
      }
      await loadAccounts()
      setName('')
      setEmail('')
      setPassword('')
      setRole('AGENT')
    } catch {
      setError('Gagal menambahkan akun')
    } finally {
      setSubmitting(false)
    }
  }

  async function resetPassword(account: Account) {
    const newPassword = window.prompt(`Kata sandi baru untuk ${account.name}:`)
    if (!newPassword) return
    setError(null)
    try {
      const res = await fetch(`/api/accounts/${account.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ password: newPassword }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        setError(body.error ?? 'Gagal mereset kata sandi')
      }
    } catch {
      setError('Gagal mereset kata sandi')
    }
  }

  async function deleteAccount(account: Account) {
    if (!window.confirm(`Hapus akun ${account.name}?`)) return
    setError(null)
    try {
      const res = await fetch(`/api/accounts/${account.id}`, { method: 'DELETE' })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        setError(body.error ?? 'Gagal menghapus akun')
        return
      }
      await loadAccounts()
    } catch {
      setError('Gagal menghapus akun')
    }
  }

  const canSubmit = name.trim() && email.trim() && password.trim().length >= 8 && !submitting

  return (
    <Card className="space-y-4 p-4">
      <h2 className="font-medium text-navy">Manajemen pengguna</h2>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Nama</TableHead>
            <TableHead>Email</TableHead>
            <TableHead>Peran</TableHead>
            <TableHead />
          </TableRow>
        </TableHeader>
        <TableBody>
          {accounts.map((account) => (
            <TableRow key={account.id}>
              <TableCell>{account.name}</TableCell>
              <TableCell className="text-muted-foreground">{account.email}</TableCell>
              <TableCell>
                <Badge variant={account.role === 'ADMIN' ? 'brand' : 'muted'}>{account.role}</Badge>
              </TableCell>
              <TableCell>
                <div className="flex justify-end gap-2">
                  <Button variant="outline" size="sm" onClick={() => resetPassword(account)}>
                    Reset Kata Sandi
                  </Button>
                  <Button variant="destructive" size="sm" onClick={() => deleteAccount(account)}>
                    Hapus
                  </Button>
                </div>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>

      <div className="space-y-2 border-t border-border pt-3">
        <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Tambah agen baru</h3>
        <div className="grid grid-cols-2 gap-2">
          <Input aria-label="Nama" placeholder="Nama" value={name} onChange={(e) => setName(e.target.value)} />
          <Input aria-label="Email" type="email" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} />
          <Input
            aria-label="Kata sandi"
            type="password"
            placeholder="Kata sandi (min. 8 karakter)"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          <Select aria-label="Peran" value={role} onChange={(e) => setRole(e.target.value as 'ADMIN' | 'AGENT')}>
            <option value="AGENT">Agent</option>
            <option value="ADMIN">Admin</option>
          </Select>
        </div>
        <Button type="button" onClick={addAccount} disabled={!canSubmit}>
          Tambah Akun
        </Button>
      </div>

      {error && <p className="text-xs text-destructive">{error}</p>}
    </Card>
  )
}
