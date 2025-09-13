import React from "react";

function ProgressBar({
  questionsStats,
  tag,
}: {
  questionsStats: { easy: number; medium: number; hard: number; total: number };
  tag: "easy" | "medium" | "hard";
}) {
  const colors: Record<"easy" | "medium" | "hard", string> = {
    easy: "green",
    medium: "yellow",
    hard: "red",
  };
  return (
    <div className="space-y-2">
      <div className="flex justify-between text-sm">
        <span className={`text-${colors[tag]}-600 font-medium`}>
          {tag === "easy" ? "Easy" : tag === "medium" ? "Medium" : "Hard"}
        </span>
        <span className="text-gray-200">
          {questionsStats[tag]}/{questionsStats.total}
        </span>
      </div>
      <div className="w-full bg-gray-200 rounded-full h-2">
        <div
          className={`bg-${colors[tag]}-500 h-2 rounded-full`}
          style={{
            width: `${(questionsStats[tag] / questionsStats.total) * 100}%`,
          }}
        ></div>
      </div>
    </div>
  );
}

export default ProgressBar;
