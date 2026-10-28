import { render, screen } from "@testing-library/react-native";
import { ScoreBadge } from "./ScoreBadge";

describe("ScoreBadge", () => {
  test("renders nothing when score is undefined (never an empty or zero pill)", async () => {
    const { toJSON } = await render(<ScoreBadge score={undefined} />);

    expect(toJSON()).toBeNull();
  });

  test("renders nothing when score is null (never an empty or zero pill)", async () => {
    const { toJSON } = await render(<ScoreBadge score={null} />);

    expect(toJSON()).toBeNull();
  });

  test("renders the score as a whole-number percentage (spec 0005 AC-2)", async () => {
    await render(<ScoreBadge score={82} />);

    expect(screen.getByText("★ 82%")).toBeOnTheScreen();
  });

  test("is decorative: exposes no button role", async () => {
    await render(<ScoreBadge score={82} />);

    expect(screen.queryByRole("button")).not.toBeOnTheScreen();
  });

  test("exposes a 'match for you' accessibility label by default", async () => {
    await render(<ScoreBadge score={82} />);

    expect(screen.getByLabelText("82% match for you")).toBeOnTheScreen();
  });

  test("exposes a 'similar to this movie' label for the similarity variant (AC-13)", async () => {
    await render(<ScoreBadge score={82} variant="similarity" />);

    expect(screen.getByLabelText("82% similar to this movie")).toBeOnTheScreen();
  });

  test("renders a genuine 0% score (distinct from null/undefined 'no data')", async () => {
    await render(<ScoreBadge score={0} />);

    expect(screen.getByText("★ 0%")).toBeOnTheScreen();
  });

  test("renders a whole-number 100% at the top of the scale", async () => {
    await render(<ScoreBadge score={100} />);

    expect(screen.getByText("★ 100%")).toBeOnTheScreen();
  });
});
