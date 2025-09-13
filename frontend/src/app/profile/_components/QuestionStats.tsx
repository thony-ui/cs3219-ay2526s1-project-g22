import { Badge } from "@/components/ui/badge";
import React from "react";

function QuestionStats({
  stats,
  tag,
}: {
  stats: number;
  tag: "E" | "M" | "H";
}) {
  const colors: Record<"E" | "M" | "H", string> = {
    E: "green",
    M: "yellow",
    H: "red",
  };
  return (
    <div className="text-center space-y-2">
      <div className="flex justify-center">
        <div
          className={`h-16 w-16 rounded-full bg-${colors[tag]}-100 flex items-center justify-center`}
        >
          <Badge
            className={`bg-${colors[tag]}-500 hover:bg-${colors[tag]}-600 text-white text-lg px-3 py-1`}
          >
            {tag}
          </Badge>
        </div>
      </div>
      <div>
        <p className="text-3xl font-bold text-green-600">{stats}</p>
        <p className="text-sm text-gray-200">
          {tag === "E" ? "Easy" : tag === "M" ? "Medium" : "Hard"}
        </p>
      </div>
    </div>
  );
}

export default QuestionStats;
