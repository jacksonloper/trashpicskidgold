import { IMAGE_MODEL_GROUPS } from "../imageProviders";

/**
 * The options of an image-model <select>: both providers' models, each under
 * its own heading, so the three pickers in the app list the same thing the
 * same way.
 */
export default function ImageModelOptions() {
  return IMAGE_MODEL_GROUPS.map((g) => (
    <optgroup key={g.provider} label={g.label}>
      {g.models.map((m) => (
        <option key={m.id} value={m.id}>
          {m.label}
        </option>
      ))}
    </optgroup>
  ));
}
