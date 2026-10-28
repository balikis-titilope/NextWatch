import { useWindowDimensions } from "react-native";
import { MAX_CONTENT_WIDTH } from "../constants/config";

// The window width capped at phone size (see MAX_CONTENT_WIDTH) -- use this
// instead of useWindowDimensions().width wherever a size is computed as a
// fraction of the screen (the Home hero, PosterCard's grid variant), so web
// on a wide browser window renders identically to the phone experience
// rather than scaling everything up with it.
export function useContentWidth(): number {
  const { width } = useWindowDimensions();
  return Math.min(width, MAX_CONTENT_WIDTH);
}
