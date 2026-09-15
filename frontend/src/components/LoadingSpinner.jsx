/**
 * Loading spinner component
 */
function LoadingSpinner({ message = 'Loading...' }) {
  return (
    <div className="loading-state">
      <div className="loading-spinner" aria-hidden="true"></div>
      <p>{message}</p>
    </div>
  );
}

export default LoadingSpinner;
