import { useCallback, useEffect, useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts'
import './App.css'

type AuthResponse = {
  access_token: string
  token_type?: string
}

type Holding = {
  id: number
  symbol: string
  asset_type: string
  quantity: number
  avg_buy_price: number
  current_price: number | null
  total_value: number | null
  profit_loss: number | null
}

type PortfolioSummary = {
  total_cost: number
  total_value: number
  unrealized_pl: number
  unrealized_pl_percent?: number | null
  holdings_count: number
  unpriced_symbols?: string[]
}

/** In dev, default to same-origin `/api/v1` so Vite proxies to the FastAPI server (see vite.config.ts). */
function apiBaseUrl(): string {
  const fromEnv = import.meta.env.VITE_API_BASE_URL?.trim()
  if (fromEnv) return fromEnv
  if (import.meta.env.DEV) return '/api/v1'
  return 'http://127.0.0.1:8080/api/v1'
}

const API_BASE_URL = apiBaseUrl()

const CHART_COLORS = ['#2563eb', '#7c3aed', '#0891b2', '#059669', '#d97706', '#dc2626', '#db2777']

const SYMBOL_PATTERN = /^[A-Z0-9][A-Z0-9.-]*$/

function parsePositiveNumber(raw: string): number | null {
  const n = Number(raw)
  if (!Number.isFinite(n) || n <= 0) return null
  return n
}

function isAddHoldingFormValid(
  symbol: string,
  quantityInput: string,
  avgBuyInput: string,
): boolean {
  const sym = symbol.trim().toUpperCase()
  if (!sym || !SYMBOL_PATTERN.test(sym)) return false
  return (
    parsePositiveNumber(quantityInput) !== null &&
    parsePositiveNumber(avgBuyInput) !== null
  )
}

type ValidationErr = { msg?: string; loc?: (string | number)[] }

async function readApiErrorMessage(res: Response): Promise<string> {
  try {
    const data = (await res.json()) as {
      detail?: string | ValidationErr[]
    }
    if (typeof data.detail === 'string') return data.detail
    if (Array.isArray(data.detail)) {
      return data.detail
        .map((e) => {
          const field =
            Array.isArray(e.loc) && e.loc.length > 0
              ? String(e.loc[e.loc.length - 1])
              : 'field'
          const msg = e.msg ?? ''
          return msg ? `${field}: ${msg}` : ''
        })
        .filter(Boolean)
        .join(' ')
    }
  } catch {
    // ignore
  }
  return res.statusText || 'Request failed'
}

async function apiFetch(
  path: string,
  init?: RequestInit,
): Promise<Response> {
  try {
    return await fetch(`${API_BASE_URL}${path}`, init)
  } catch {
    throw new Error(
      'Cannot reach the API. Start the backend (see README), and ensure VITE_API_BASE_URL in frontend/.env matches the API port.',
    )
  }
}

const USER_EMAIL_KEY = 'user_email'

function App() {
  const [token, setToken] = useState<string | null>(() =>
    localStorage.getItem('token'),
  )
  const [authMode, setAuthMode] = useState<'register' | 'login'>('register')
  const [email, setEmail] = useState(
    () => localStorage.getItem(USER_EMAIL_KEY) ?? '',
  )
  const [password, setPassword] = useState('')
  const [symbol, setSymbol] = useState('')
  const [quantityInput, setQuantityInput] = useState('')
  const [avgBuyInput, setAvgBuyInput] = useState('')
  const [holdings, setHoldings] = useState<Holding[]>([])
  const [summary, setSummary] = useState<PortfolioSummary | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [initialLoading, setInitialLoading] = useState(false)
  const [pricesRefreshing, setPricesRefreshing] = useState(false)
  const [authSubmitting, setAuthSubmitting] = useState(false)
  const [holdingSaving, setHoldingSaving] = useState(false)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [editQtyInput, setEditQtyInput] = useState('')
  const [editAvgInput, setEditAvgInput] = useState('')
  const [editSaving, setEditSaving] = useState(false)
  const [holdingFilter, setHoldingFilter] = useState('')
  const [infoMessage, setInfoMessage] = useState<string | null>(null)
  const [warnMessage, setWarnMessage] = useState<string | null>(null)

  const clearSession = useCallback(() => {
    localStorage.removeItem('token')
    setToken(null)
    setHoldings([])
    setSummary(null)
    setInfoMessage(null)
    setWarnMessage(null)
    setError(null)
  }, [])

  const persistSession = useCallback((data: AuthResponse, userEmail: string) => {
    if (!data.access_token?.trim()) {
      throw new Error('Server did not return an access token. Try again.')
    }
    localStorage.setItem('token', data.access_token)
    localStorage.setItem(USER_EMAIL_KEY, userEmail)
    setToken(data.access_token)
    setEmail(userEmail)
    setError(null)
  }, [])

  const chartData = useMemo(
    () =>
      holdings
        .filter((holding) => holding.total_value !== null)
        .map((holding) => ({
          name: holding.symbol,
          value: Number((holding.total_value ?? 0).toFixed(2)),
        })),
    [holdings],
  )

  const filteredHoldings = useMemo(() => {
    const q = holdingFilter.trim().toUpperCase()
    if (!q) return holdings
    return holdings.filter((h) => h.symbol.toUpperCase().includes(q))
  }, [holdings, holdingFilter])

  const addFormValid = useMemo(
    () => isAddHoldingFormValid(symbol, quantityInput, avgBuyInput),
    [symbol, quantityInput, avgBuyInput],
  )

  const addSymbolError = useMemo(() => {
    const sym = symbol.trim().toUpperCase()
    if (!symbol.trim()) return null
    if (!SYMBOL_PATTERN.test(sym)) {
      return 'Use letters, digits, dots, or hyphens only (e.g. AAPL, BRK.B).'
    }
    return null
  }, [symbol])

  const addQuantityError = useMemo(() => {
    if (!quantityInput.trim()) return null
    if (parsePositiveNumber(quantityInput) === null) {
      return 'Enter a finite number greater than 0.'
    }
    return null
  }, [quantityInput])

  const addAvgError = useMemo(() => {
    if (!avgBuyInput.trim()) return null
    if (parsePositiveNumber(avgBuyInput) === null) {
      return 'Enter a finite number greater than 0.'
    }
    return null
  }, [avgBuyInput])

  const editFormValid = useMemo(
    () =>
      parsePositiveNumber(editQtyInput) !== null &&
      parsePositiveNumber(editAvgInput) !== null,
    [editQtyInput, editAvgInput],
  )

  const authFormValid = useMemo(() => {
    if (!email.trim() || !password) return false
    if (authMode === 'register' && password.length < 8) return false
    return true
  }, [email, password, authMode])

  const fetchDashboardData = useCallback(
    async (authToken: string) => {
      const [holdingsRes, summaryRes, meRes] = await Promise.all([
        apiFetch('/holdings', {
          headers: { Authorization: `Bearer ${authToken}` },
        }),
        apiFetch('/portfolio/summary', {
          headers: { Authorization: `Bearer ${authToken}` },
        }),
        apiFetch('/auth/me', {
          headers: { Authorization: `Bearer ${authToken}` },
        }),
      ])

      if (
        holdingsRes.status === 401 ||
        summaryRes.status === 401 ||
        meRes.status === 401
      ) {
        clearSession()
        throw new Error('Your session expired or is invalid. Please sign in again.')
      }

      if (!holdingsRes.ok || !summaryRes.ok) {
        throw new Error('Failed to load dashboard data')
      }

      const holdingsData = (await holdingsRes.json()) as Holding[]
      const summaryData = (await summaryRes.json()) as PortfolioSummary
      setHoldings(holdingsData)
      setSummary(summaryData)
      if (meRes.ok) {
        const me = (await meRes.json()) as { email?: string }
        if (typeof me.email === 'string' && me.email.trim()) {
          const next = me.email.trim()
          setEmail(next)
          localStorage.setItem(USER_EMAIL_KEY, next)
        }
      }

      return { holdingsCount: holdingsData.length }
    },
    [clearSession],
  )

  useEffect(() => {
    if (!token) return
    let cancelled = false
    void (async () => {
      setInitialLoading(true)
      setError(null)
      try {
        await fetchDashboardData(token)
      } catch (err: unknown) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Unable to load your portfolio right now.')
        }
      } finally {
        if (!cancelled) setInitialLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [token, fetchDashboardData])

  const onAuthSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setError(null)
    setWarnMessage(null)
    setAuthSubmitting(true)
    try {
      if (authMode === 'register') {
        const regRes = await apiFetch('/auth/register', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, password }),
        })
        if (!regRes.ok) {
          const detail = await readApiErrorMessage(regRes)
          throw new Error(detail.trim() || 'Registration failed.')
        }
      }

      const loginRes = await apiFetch('/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      })
      if (!loginRes.ok) {
        const detail = await readApiErrorMessage(loginRes)
        throw new Error(
          detail.trim() ||
            (authMode === 'register'
              ? 'Account was created but sign-in failed. Try Sign in manually.'
              : 'Sign-in failed. Use Create account if you have not registered yet.'),
        )
      }

      const data = (await loginRes.json()) as AuthResponse
      persistSession(data, email.trim())
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.')
    } finally {
      setAuthSubmitting(false)
    }
  }

  const addHolding = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!token) return

    const sym = symbol.trim().toUpperCase()
    const quantity = parsePositiveNumber(quantityInput)
    const avgBuyPrice = parsePositiveNumber(avgBuyInput)

    if (!sym) {
      setError('Enter a symbol (e.g. AAPL).')
      return
    }
    if (!SYMBOL_PATTERN.test(sym)) {
      setError(
        'Symbol may only contain letters, digits, dots, and hyphens, starting with a letter or digit (e.g. AAPL, BRK.B).',
      )
      return
    }
    if (quantity === null) {
      setError('Quantity must be a finite number greater than 0 (e.g. 10 or 0.5).')
      return
    }
    if (avgBuyPrice === null) {
      setError('Average buy price must be a finite number greater than 0 (e.g. 150.25).')
      return
    }

    setError(null)
    setInfoMessage(null)
    setWarnMessage(null)
    setHoldingSaving(true)
    try {
      const res = await apiFetch('/holdings', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          symbol: sym,
          quantity,
          avg_buy_price: avgBuyPrice,
          asset_type: 'stock',
        }),
      })

      if (res.status === 401) {
        clearSession()
        setError('Your session expired. Please sign in again.')
        return
      }

      if (!res.ok) {
        const apiMsg = await readApiErrorMessage(res)
        setError(
          apiMsg.includes('already hold')
            ? `Duplicate holding: ${apiMsg}`
            : apiMsg,
        )
        return
      }

      setSymbol('')
      setQuantityInput('')
      setAvgBuyInput('')
      await fetchDashboardData(token)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save holding.')
    } finally {
      setHoldingSaving(false)
    }
  }

  const deleteHolding = async (symbol: string, holdingId: number) => {
    if (!token) return
    if (!window.confirm(`Remove ${symbol} from your portfolio?`)) return
    setError(null)
    setInfoMessage(null)
    setWarnMessage(null)
    try {
      const res = await apiFetch(`/holdings/${holdingId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      })
      if (res.status === 401) {
        clearSession()
        setError('Your session expired. Please sign in again.')
        return
      }
      if (!res.ok) {
        setError(await readApiErrorMessage(res))
        return
      }
      if (editingId === holdingId) {
        setEditingId(null)
        setEditQtyInput('')
        setEditAvgInput('')
      }
      await fetchDashboardData(token)
      setInfoMessage(`Removed ${symbol}.`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not remove holding.')
    }
  }

  const startEdit = (holding: Holding) => {
    setError(null)
    setInfoMessage(null)
    setWarnMessage(null)
    setEditingId(holding.id)
    setEditQtyInput(String(holding.quantity))
    setEditAvgInput(String(holding.avg_buy_price))
  }

  const cancelEdit = () => {
    setEditingId(null)
    setEditQtyInput('')
    setEditAvgInput('')
  }

  const saveEdit = async () => {
    if (!token || editingId === null) return
    const quantity = parsePositiveNumber(editQtyInput)
    const avgBuyPrice = parsePositiveNumber(editAvgInput)
    if (quantity === null) {
      setError('Quantity must be a finite number greater than 0.')
      return
    }
    if (avgBuyPrice === null) {
      setError('Average buy price must be a finite number greater than 0.')
      return
    }
    setError(null)
    setInfoMessage(null)
    setWarnMessage(null)
    setEditSaving(true)
    try {
      const res = await apiFetch(`/holdings/${editingId}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ quantity, avg_buy_price: avgBuyPrice }),
      })
      if (res.status === 401) {
        clearSession()
        setError('Your session expired. Please sign in again.')
        return
      }
      if (!res.ok) {
        setError(await readApiErrorMessage(res))
        return
      }
      cancelEdit()
      await fetchDashboardData(token)
      setInfoMessage('Holding updated.')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not update holding.')
    } finally {
      setEditSaving(false)
    }
  }

  const exportHoldingsCsv = async () => {
    if (!token) return
    setError(null)
    setInfoMessage(null)
    setWarnMessage(null)
    try {
      const res = await apiFetch('/holdings/export.csv', {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (res.status === 401) {
        clearSession()
        setError('Your session expired. Please sign in again.')
        return
      }
      if (!res.ok) {
        setError(await readApiErrorMessage(res))
        return
      }
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `portfolio_holdings_${new Date().toISOString().slice(0, 10)}.csv`
      a.click()
      URL.revokeObjectURL(url)
      setInfoMessage('Downloaded holdings CSV.')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not export CSV.')
    }
  }

  const refreshPrices = async () => {
    if (!token) return
    setPricesRefreshing(true)
    setError(null)
    setInfoMessage(null)
    setWarnMessage(null)
    try {
      const res = await apiFetch('/prices/refresh', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      })
      if (res.status === 401) {
        clearSession()
        setError('Your session expired. Please sign in again.')
        return
      }
      if (!res.ok) {
        setError(await readApiErrorMessage(res))
        return
      }
      const data = (await res.json()) as { updated: number; failed: string[] }
      const { holdingsCount } = await fetchDashboardData(token)
      if (data.failed?.length) {
        setWarnMessage(
          `No quote returned for: ${data.failed.join(', ')}. Those rows stay unpriced until a quote can be saved; other rows were updated if possible.`,
        )
      }
      if (data.updated > 0) {
        setInfoMessage(
          `Saved fresh quotes for ${data.updated} holding${data.updated === 1 ? '' : 's'}.`,
        )
      } else if (holdingsCount === 0) {
        setInfoMessage('Add a holding first, then refresh prices.')
      } else if (!data.failed?.length) {
        setInfoMessage('Quotes are up to date (nothing new to save).')
      } else {
        setInfoMessage('No new quote snapshots were saved this run.')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not refresh prices.')
    } finally {
      setPricesRefreshing(false)
    }
  }

  const logout = () => {
    localStorage.removeItem(USER_EMAIL_KEY)
    clearSession()
    setEmail('')
    setPassword('')
  }

  if (!token) {
    return (
      <div className="auth-page">
        <main className="auth-card">
          <div className="brand">
            <span className="brand-mark" aria-hidden />
            <div>
              <h1>Portfolio Analytics</h1>
              <p className="subheading">Track holdings, allocation, and unrealized P/L.</p>
            </div>
          </div>
          <p className="auth-hint">
            New here? Use <strong>Create account</strong> first, then sign in anytime.
          </p>
          <div className="auth-tabs" role="tablist" aria-label="Account">
            <button
              type="button"
              className={authMode === 'register' ? 'tab active' : 'tab'}
              onClick={() => {
                setAuthMode('register')
                setError(null)
                setWarnMessage(null)
              }}
            >
              Create account
            </button>
            <button
              type="button"
              className={authMode === 'login' ? 'tab active' : 'tab'}
              onClick={() => {
                setAuthMode('login')
                setError(null)
                setWarnMessage(null)
              }}
            >
              Sign in
            </button>
          </div>
          <form className="auth-form" onSubmit={onAuthSubmit}>
            <label className="field">
              <span>Email</span>
              <input
                type="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </label>
            <label className="field">
              <span>Password {authMode === 'register' && '(8+ characters)'}</span>
              <input
                type="password"
                autoComplete={authMode === 'register' ? 'new-password' : 'current-password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                minLength={authMode === 'register' ? 8 : undefined}
                required
              />
            </label>
            <button type="submit" disabled={authSubmitting || !authFormValid}>
              {authSubmitting
                ? 'Please wait…'
                : authMode === 'register'
                  ? 'Create account & sign in'
                  : 'Sign in'}
            </button>
            {error && <p className="error" role="alert">{error}</p>}
          </form>
        </main>
      </div>
    )
  }

  return (
    <div className="app-shell">
      <main className="container">
        <header className="header">
          <div>
            <h1>Dashboard</h1>
            <p className="subheading">Signed in as <span className="email-badge">{email || '—'}</span></p>
          </div>
          <div className="actions">
            <button
              type="button"
              onClick={exportHoldingsCsv}
              disabled={initialLoading || holdings.length === 0}
              className="secondary"
            >
              Export CSV
            </button>
            <button
              type="button"
              onClick={() => void refreshPrices()}
              disabled={initialLoading || pricesRefreshing}
            >
              {pricesRefreshing ? 'Refreshing quotes…' : 'Refresh prices'}
            </button>
            <button type="button" className="secondary" onClick={logout}>
              Log out
            </button>
          </div>
        </header>

        {error && (
          <p className="error banner-error" role="alert">
            {error}
          </p>
        )}
        {infoMessage && !error && (
          <p className="banner-info" role="status">
            {infoMessage}
          </p>
        )}
        {!error &&
          (warnMessage ||
            (summary &&
              summary.unpriced_symbols &&
              summary.unpriced_symbols.length > 0)) && (
            <div className="banner-warn" role="status">
              {summary &&
                summary.unpriced_symbols &&
                summary.unpriced_symbols.length > 0 && (
                  <p className="banner-warn-line">
                    No quote on file for{' '}
                    <strong>{summary.unpriced_symbols.join(', ')}</strong>. Total value and
                    unrealized P/L count only holdings with a saved price. Use Refresh prices after
                    adding symbols; invalid tickers may stay unpriced.
                  </p>
                )}
              {warnMessage && <p className="banner-warn-line">{warnMessage}</p>}
            </div>
          )}

        <section className={`metrics-grid${initialLoading ? ' metrics-loading' : ''}`} aria-busy={initialLoading}>
          <article className="panel metric">
            <h3>Total value</h3>
            <p className="metric-value">
              {initialLoading && !summary ? '…' : `$${summary?.total_value.toFixed(2) ?? '0.00'}`}
            </p>
          </article>
          <article className="panel metric">
            <h3>Total cost</h3>
            <p className="metric-value">
              {initialLoading && !summary ? '…' : `$${summary?.total_cost.toFixed(2) ?? '0.00'}`}
            </p>
          </article>
          <article className="panel metric">
            <h3>Unrealized P/L</h3>
            <p
              className={`metric-value ${(summary?.unrealized_pl ?? 0) >= 0 ? 'gain' : 'loss'}`}
            >
              {initialLoading && !summary ? '…' : `$${summary?.unrealized_pl.toFixed(2) ?? '0.00'}`}
            </p>
            {!initialLoading &&
              summary &&
              summary.unrealized_pl_percent != null &&
              summary.unrealized_pl_percent !== undefined && (
                <p className="muted metric-sub">
                  {summary.unrealized_pl_percent >= 0 ? '+' : ''}
                  {summary.unrealized_pl_percent.toFixed(2)}% on priced cost basis
                </p>
              )}
          </article>
          <article className="panel metric">
            <h3>Holdings</h3>
            <p className="metric-value tabular">
              {initialLoading && summary === null ? '…' : (summary?.holdings_count ?? 0)}
            </p>
          </article>
        </section>

        <section className="content-grid">
          <div className="panel add-holding-panel">
            <h2>Add holding</h2>
            <p className="muted form-hint">
              Ticker symbols only (letters, digits, dots, hyphens). Quantities and cost must be greater than zero.
            </p>
            <form className="add-form" onSubmit={addHolding} noValidate>
              <div className="field-block">
                <input
                  type="text"
                  value={symbol}
                  onChange={(e) => setSymbol(e.target.value.toUpperCase())}
                  placeholder="Symbol (e.g. AAPL, BRK.B)"
                  autoComplete="off"
                  aria-label="Symbol"
                  aria-describedby="hint-symbol"
                  aria-invalid={addSymbolError ? true : undefined}
                />
                <span id="hint-symbol" className="input-hint">
                  Use the same symbol you would look up on Yahoo Finance.
                </span>
                {addSymbolError && (
                  <span className="field-error" role="alert">
                    {addSymbolError}
                  </span>
                )}
              </div>
              <div className="field-block">
                <input
                  type="number"
                  step="any"
                  min="0"
                  inputMode="decimal"
                  value={quantityInput}
                  onChange={(e) => setQuantityInput(e.target.value)}
                  placeholder="Quantity (e.g. 10)"
                  aria-label="Quantity"
                  aria-describedby="hint-qty"
                  aria-invalid={addQuantityError ? true : undefined}
                />
                <span id="hint-qty" className="input-hint">
                  Whole or fractional shares; must be &gt; 0.
                </span>
                {addQuantityError && (
                  <span className="field-error" role="alert">
                    {addQuantityError}
                  </span>
                )}
              </div>
              <div className="field-block">
                <input
                  type="number"
                  step="any"
                  min="0"
                  inputMode="decimal"
                  value={avgBuyInput}
                  onChange={(e) => setAvgBuyInput(e.target.value)}
                  placeholder="Avg buy price per share (e.g. 150.25)"
                  aria-label="Average buy price"
                  aria-describedby="hint-avg"
                  aria-invalid={addAvgError ? true : undefined}
                />
                <span id="hint-avg" className="input-hint">
                  Your average cost basis per share; must be &gt; 0.
                </span>
                {addAvgError && (
                  <span className="field-error" role="alert">
                    {addAvgError}
                  </span>
                )}
              </div>
              <button
                type="submit"
                className="add-holding-submit"
                disabled={holdingSaving || initialLoading || !addFormValid}
                title={
                  !addFormValid
                    ? 'Enter a valid symbol, quantity, and average buy price to enable Save.'
                    : undefined
                }
              >
                {holdingSaving ? 'Saving…' : 'Save holding'}
              </button>
            </form>
          </div>

          <div className="panel chart-panel">
            <h2>Allocation</h2>
            {chartData.length === 0 ? (
              <p className="muted">Add holdings to see allocation by value.</p>
            ) : (
              <ResponsiveContainer width="100%" height={260}>
                <PieChart>
                  <Pie
                    data={chartData}
                    dataKey="value"
                    nameKey="name"
                    outerRadius={88}
                    innerRadius={28}
                    paddingAngle={2}
                    stroke="var(--surface)"
                    strokeWidth={2}
                  >
                    {chartData.map((_, i) => (
                      <Cell key={`slice-${i}`} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip
                    formatter={(value) => [
                      typeof value === 'number' ? `$${value.toFixed(2)}` : '—',
                      'Value',
                    ]}
                  />
                </PieChart>
              </ResponsiveContainer>
            )}
          </div>
        </section>

        <section className="panel holdings-panel">
          <div className="holdings-panel-head">
            <h2>Holdings</h2>
            {holdings.length > 0 && (
              <label className="filter-label">
                <span className="sr-only">Filter by symbol</span>
                <input
                  type="search"
                  value={holdingFilter}
                  onChange={(e) => setHoldingFilter(e.target.value)}
                  placeholder="Filter symbols…"
                  className="filter-input"
                  aria-label="Filter holdings by symbol"
                />
              </label>
            )}
          </div>
          {initialLoading ? (
            <p className="muted loading-line">Loading portfolio…</p>
          ) : holdings.length === 0 ? (
            <p className="muted">No holdings yet. Add a symbol above.</p>
          ) : filteredHoldings.length === 0 ? (
            <p className="muted">No holdings match your filter.</p>
          ) : (
            <div className="table-wrap">
              <p className="muted table-caption">
                An em dash (—) in Current, Value, or P/L means no saved quote yet for that row; try
                Refresh prices or verify the ticker.
              </p>
              <table className="holdings-table">
                <thead>
                  <tr>
                    <th>Symbol</th>
                    <th>Qty</th>
                    <th>Avg buy</th>
                    <th>Current</th>
                    <th>Value</th>
                    <th>P/L</th>
                    <th className="actions-col">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredHoldings.map((holding) => (
                    <tr key={holding.id}>
                      <td className="sym">{holding.symbol}</td>
                      <td className="tabular">
                        {editingId === holding.id ? (
                          <input
                            className="table-input"
                            type="number"
                            step="any"
                            value={editQtyInput}
                            onChange={(e) => setEditQtyInput(e.target.value)}
                            aria-label={`Edit quantity for ${holding.symbol}`}
                          />
                        ) : (
                          holding.quantity
                        )}
                      </td>
                      <td className="tabular">
                        {editingId === holding.id ? (
                          <input
                            className="table-input"
                            type="number"
                            step="any"
                            value={editAvgInput}
                            onChange={(e) => setEditAvgInput(e.target.value)}
                            aria-label={`Edit average buy for ${holding.symbol}`}
                          />
                        ) : (
                          `$${holding.avg_buy_price.toFixed(2)}`
                        )}
                      </td>
                      <td className="tabular">
                        {holding.current_price != null
                          ? `$${holding.current_price.toFixed(2)}`
                          : '—'}
                      </td>
                      <td className="tabular">
                        {holding.total_value != null
                          ? `$${holding.total_value.toFixed(2)}`
                          : '—'}
                      </td>
                      <td
                        className={`tabular ${(holding.profit_loss ?? 0) >= 0 ? 'gain' : 'loss'}`}
                      >
                        {holding.profit_loss != null
                          ? `$${holding.profit_loss.toFixed(2)}`
                          : '—'}
                      </td>
                      <td className="row-actions">
                        {editingId === holding.id ? (
                          <>
                            <button
                              type="button"
                              className="compact"
                              disabled={editSaving || !editFormValid}
                              onClick={() => void saveEdit()}
                            >
                              {editSaving ? '…' : 'Save'}
                            </button>
                            <button
                              type="button"
                              className="secondary compact"
                              disabled={editSaving}
                              onClick={cancelEdit}
                            >
                              Cancel
                            </button>
                          </>
                        ) : (
                          <>
                            <button
                              type="button"
                              className="secondary ghost compact"
                              onClick={() => startEdit(holding)}
                            >
                              Edit
                            </button>
                            <button
                              type="button"
                              className="danger ghost compact"
                              onClick={() => void deleteHolding(holding.symbol, holding.id)}
                            >
                              Remove
                            </button>
                          </>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </main>
    </div>
  )
}

export default App
