import React from 'react';

// Keeps one broken widget from blanking the whole site for the client.
export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error('App crashed:', error, info);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="boot">
        <div className="card boot-card">
          <h1>Something went wrong</h1>
          <p className="muted small">The page hit an unexpected error. Reloading usually fixes it.</p>
          <p className="error small">{String(this.state.error.message || this.state.error)}</p>
          <button className="btn primary" onClick={() => window.location.reload()}>
            Reload
          </button>
        </div>
      </div>
    );
  }
}
