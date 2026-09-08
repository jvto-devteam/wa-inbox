'use client'
import { useEffect, useState } from 'react'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { EmptyState } from '@/components/ui/empty-state'
import { Field, FieldError } from '@/components/ui/label'
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table'
import { FormSection } from '@/components/settings/section'
import { fetchJson } from '@/lib/fetch-json'

type Account = { id: string; name: string; email: string; role: 'ADMIN' | 'AGENT' }

export function UserManagementSection() {
  const [accounts, setAccounts] = useState<Account[]>([])
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [role, setRole] = useState<'ADMIN' | 'AGENT'>('AGENT')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  // Resolves rather than rejects on failure: addAccount/deleteAccount await it after their
  // own request already succeeded, so a re-load failure must surface as its own message
  // instead of being caught by their handler and mislabelled "Gagal menambahkan akun".
  function loadAccounts() {
    return fetchJson<Account[]>('/api/accounts')
      .then(setAccounts)
      .catch(() => setError('Gagal memuat daftar akun'))
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
    <FormSection
      title="Manajemen pengguna"
      description="Hanya dua peran yang ada: Admin boleh mengubah setelan dan menghapus akun, Agent hanya membalas percakapan."
    >
      <div className="space-y-5">
        <div className="rounded-lg border border-line bg-surface">
          {accounts.length === 0 ? (
            <EmptyState title="Belum ada akun." description="Tambahkan akun pertama lewat formulir di bawah." />
          ) : (
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
                    <TableCell className="font-medium text-ink">{account.name}</TableCell>
                    <TableCell className="text-ink-muted">{account.email}</TableCell>
                    <TableCell>
                      <Badge variant={account.role === 'ADMIN' ? 'default' : 'muted'}>{account.role}</Badge>
                    </TableCell>
                    <TableCell>
                      <div className="flex justify-end gap-2">
                        <Button variant="outline" size="sm" onClick={() => resetPassword(account)}>
                          Reset kata sandi
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
          )}
        </div>

        <div className="space-y-3 border-t border-line pt-4">
          <h3 className="text-sm font-semibold text-ink">Tambah agen baru</h3>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Nama" htmlFor="new-account-name">
              <Input id="new-account-name" placeholder="Nama" value={name} onChange={(e) => setName(e.target.value)} />
            </Field>
            <Field label="Email" htmlFor="new-account-email">
              <Input
                id="new-account-email"
                type="email"
                placeholder="Email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </Field>
            <Field label="Kata sandi" htmlFor="new-account-password" hint="Minimal 8 karakter.">
              <Input
                id="new-account-password"
                type="password"
                placeholder="Kata sandi"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </Field>
            <Field label="Peran" htmlFor="new-account-role">
              <Select
                id="new-account-role"
                value={role}
                onChange={(e) => setRole(e.target.value as 'ADMIN' | 'AGENT')}
                className="w-full"
              >
                <option value="AGENT">Agent</option>
                <option value="ADMIN">Admin</option>
              </Select>
            </Field>
          </div>
          <Button type="button" onClick={addAccount} disabled={!canSubmit}>
            Tambah akun
          </Button>
        </div>

        {error && <FieldError className="text-sm">{error}</FieldError>}
      </div>
    </FormSection>
  )
}
