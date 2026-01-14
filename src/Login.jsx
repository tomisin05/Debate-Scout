import { signInWithPopup } from 'firebase/auth'
import { auth, googleProvider } from './firebase'
import './Login.css'

function Login({ onLogin }) {
  const handleGoogleSignIn = async () => {
    try {
      const result = await signInWithPopup(auth, googleProvider)
      onLogin(result.user)
    } catch (error) {
      console.error('Error signing in:', error)
    }
  }

  return (
    <div className="login-container">
      <div className="login-box">
        <div className="logo">
          <i className="fas fa-table"></i>
        </div>
        <h1>Debate Scout</h1>
        <p>Sign in to access tournament data and round reports</p>
        <button className="google-btn" onClick={handleGoogleSignIn}>
          <i className="fab fa-google"></i>
          Sign in with Google
        </button>
      </div>
    </div>
  )
}

export default Login
