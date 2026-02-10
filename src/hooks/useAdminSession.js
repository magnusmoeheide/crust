import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  OAuthProvider,
  onAuthStateChanged,
  signInWithPopup,
  signOut,
} from 'firebase/auth'
import { auth } from '../firebase'

function isCrustEmail(email) {
  return typeof email === 'string' && /@crust\.no$/i.test(email)
}

export function useAdminSession() {
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (nextUser) => {
      if (!nextUser) {
        setUser(null)
        setLoading(false)
        return
      }

      const nextEmail = nextUser.email || ''
      if (!isCrustEmail(nextEmail)) {
        await signOut(auth)
        setUser(null)
        setError('Kun @crust.no-kontoer har admin-tilgang.')
        setLoading(false)
        return
      }

      setUser(nextUser)
      setLoading(false)
    })

    return unsubscribe
  }, [])

  const signIn = useCallback(async () => {
    setError('')
    const provider = new OAuthProvider('microsoft.com')
    provider.setCustomParameters({ prompt: 'select_account' })

    try {
      const credential = await signInWithPopup(auth, provider)
      if (!isCrustEmail(credential.user?.email || '')) {
        await signOut(auth)
        setError('Kun @crust.no-kontoer har admin-tilgang.')
      }
    } catch (err) {
      if (err?.code === 'auth/popup-closed-by-user') {
        return
      }
      setError('Innlogging feilet. Prøv igjen.')
    }
  }, [])

  const signOutAdmin = useCallback(async () => {
    setError('')
    await signOut(auth)
  }, [])

  return useMemo(
    () => ({
      user,
      loading,
      error,
      isAdmin: Boolean(user),
      signIn,
      signOutAdmin,
    }),
    [error, loading, signIn, signOutAdmin, user],
  )
}
