/**
 * What a second tab sees instead of the app.
 *
 * Plain words, one button. The other tab is still the app and nothing has
 * happened to the story there; this one is just not going to join in.
 */
export default function SecondTabNotice({ onTakeOver }) {
  return (
    <div className="age-gate-overlay">
      <div className="age-gate-dialog second-tab-notice" role="alertdialog">
        <h2>Story Maker is open in another tab</h2>
        <p>
          Stories are kept in this browser, and two tabs working on them at
          once would write over each other. Close this tab and carry on in
          the other one — or take over here, and the other tab will stand
          aside instead.
        </p>
        <button
          type="button"
          className="btn-primary age-gate-btn"
          onClick={onTakeOver}
        >
          Use this tab instead
        </button>
      </div>
    </div>
  );
}
