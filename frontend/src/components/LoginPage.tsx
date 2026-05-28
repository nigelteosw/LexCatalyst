import { GoogleLogin } from '@react-oauth/google'

interface LoginPageProps {
  onLoginSuccess: (credential: string) => void
  error?: string | null
}

export function LoginPage({ onLoginSuccess, error }: LoginPageProps) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-[#f6f5f2] p-4 text-neutral-950">
      <div className="w-full max-w-md space-y-8 rounded-2xl border border-neutral-200 bg-white p-10 shadow-sm">
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

        <div className="mt-8 flex justify-center">
          <GoogleLogin
            onSuccess={(credentialResponse) => {
              if (credentialResponse.credential) {
                onLoginSuccess(credentialResponse.credential)
              }
            }}
            onError={() => {
              console.error('Login Failed')
            }}
            useOneTap
            shape="rectangular"
            theme="outline"
          />
        </div>

        <div className="mt-6 text-center text-xs text-neutral-500">
          By signing in, you agree to our Terms of Service and Privacy Policy.
        </div>
      </div>
    </div>
  )
}
