"use client";

import React from "react";
import CodeEditor from "../_components/CodeEditor";
import { useGetRandomQuestion } from "@/queries/use-get-questions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default function RoomPage({
  params,
}: {
  params: Promise<{ roomId: string }>;
}) {
  const { roomId } = React.use(params);

  // Fetch a random question - you might want to modify this based on room preferences
  const {
    data: question,
    isLoading,
    error,
  } = useGetRandomQuestion("Medium", ["Array"]);

  if (isLoading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="text-lg">Loading question...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="text-lg text-red-600">Error loading question</div>
      </div>
    );
  }

  return (
    <div className="flex h-screen bg-gradient-to-br from-slate-900 via-blue-900 to-slate-800">
      {/* Question Sidebar */}
      <div className="w-2/5 min-h-0 flex flex-col">
        <div className="flex-1 p-6 overflow-hidden">
          <Card className="bg-slate-800/80 backdrop-blur-sm border-slate-600/50 h-full flex flex-col shadow-2xl gap-0">
            <CardHeader className="pb-4 border-b border-slate-600/30">
              <div className="flex items-start justify-between gap-4">
                <CardTitle className="text-white text-xl font-bold leading-tight flex-1">
                  {question?.title || "No Question Available"}
                </CardTitle>
                {question?.difficulty && (
                  <span
                    className={`shrink-0 inline-flex items-center px-3 py-1 rounded-full text-xs font-semibold shadow-lg ${
                      question.difficulty === "Easy"
                        ? "bg-emerald-500 text-white"
                        : question.difficulty === "Medium"
                        ? "bg-amber-500 text-white"
                        : "bg-red-500 text-white"
                    }`}
                  >
                    {question.difficulty}
                  </span>
                )}
              </div>
            </CardHeader>

            <CardContent className="flex-1 overflow-y-auto pr-10 pl-6 py-6 bg-white my-0">
              <div className="space-y-6">
                {/* Question Content */}
                <div className="question-content">
                  {question?.content ? (
                    <div
                      className="prose prose-invert prose-sm max-w-none 
                                prose-headings:text-slate-200 prose-p:text-slate-300 
                                prose-strong:text-white prose-code:bg-slate-700/50 
                                prose-code:text-emerald-400 prose-code:px-1 prose-code:py-0.5 
                                prose-code:rounded prose-pre:bg-slate-900/50 
                                prose-pre:border prose-pre:border-slate-600/30"
                      dangerouslySetInnerHTML={{ __html: question.content }}
                    />
                  ) : (
                    <p className="text-slate-400 text-center py-8 italic">
                      No question content available
                    </p>
                  )}
                </div>

                {/* Tags */}
                {question?.tags && question.tags.length > 0 && (
                  <div className="border-t border-slate-600/30 pt-4">
                    <p className="text-sm text-slate-400 mb-3 font-medium">
                      Tags:
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {question.tags.map((tag, index) => (
                        <span
                          key={index}
                          className="bg-blue-600/80 hover:bg-blue-500/80 text-white px-3 py-1 
                                   rounded-full text-xs font-medium transition-colors duration-200 
                                   shadow-sm border border-blue-500/30"
                        >
                          {tag}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Code Editor Section */}
      <div className="w-3/5 min-h-0 flex flex-col p-6 pl-3">
        <div className="h-full bg-slate-800/60 backdrop-blur-sm rounded-xl shadow-2xl border border-slate-600/50 overflow-hidden">
          <CodeEditor sessionId={roomId} question={question} />
        </div>
      </div>
    </div>
  );
}
