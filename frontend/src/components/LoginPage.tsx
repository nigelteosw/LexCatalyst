import { GoogleLogin } from '@react-oauth/google'

interface LoginPageProps {
  onLoginSuccess: (credential: string) => void
  onLoginError: (message: string) => void
  error?: string | null
}

export function LoginPage({ onLoginSuccess, onLoginError, error }: LoginPageProps) {
  return (
    <div className="app-scroll-region flex h-full min-h-0 items-center justify-center overflow-y-auto bg-[#f6f5f2] p-4 text-neutral-950">
      <div className="min-w-0 w-full max-w-md space-y-8 rounded-2xl border border-neutral-200 bg-white p-6 shadow-sm sm:p-10">
        <div className="text-center">
          <h1 className="text-3xl font-bold tracking-tight text-neutral-900">LexCatalyst</h1>
          <p className="mt-3 text-sm text-neutral-600">
            Secure legal workflow assistant. Please sign in with your Google account to continue.
          </p>
        </div>

        {error && (
          <div className="rounded-md bg-red-50 p-3 text-sm text-red-600 border border-red-100">
            {error}
          </div>
        )}

        <div className="mt-8 flex min-w-0 justify-center overflow-hidden">
          <GoogleLogin
            onSuccess={(credentialResponse) => {
              if (credentialResponse.credential) {
                onLoginSuccess(credentialResponse.credential)
              }
            }}
            onError={() => {
              onLoginError('Google sign-in failed. Please try again.')
            }}
            useOneTap
            shape="rectangular"
            theme="outline"
            width="240"
          />
        </div>

        <div className="mt-6 text-center text-xs text-neutral-500">
          By signing in, you agree to our Terms of Service and Privacy Policy.
        </div>
      </div>
    </div>
  )
}
