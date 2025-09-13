"use client";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Edit2, Trophy, Target, Zap } from "lucide-react";
import { useUser } from "@/contexts/user-context";
import { useState } from "react";
import { Header } from "../_components/Header";
import Footer from "../_components/Footer";
import { invalidateUser, useUpdateUser } from "@/mutations/use-update-user";
import { showToast } from "@/utils/toast-helper";

export default function ProfilePage() {
  const { user } = useUser();
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const [editForm, setEditForm] = useState({
    name: user?.name || "",
  });
  const { mutateAsync: updateUser } = useUpdateUser();

  // Mock data for questions solved - replace with actual data from your backend
  const questionsStats = {
    total: 127,
    easy: 45,
    medium: 62,
    hard: 20,
  };

  const handleEditSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await updateUser(editForm);
      showToast("Profile updated successfully", {
        success: true,
      });
      invalidateUser();
    } catch (error) {
      console.error("Error updating user:", error);
    } finally {
      setIsEditDialogOpen(false);
    }
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setEditForm((prev) => ({
      ...prev,
      [e.target.name]: e.target.value,
    }));
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-blue-900 to-slate-800 flex flex-col">
      <Header />
      <main className="flex-grow">
        <div className="container mx-auto py-8 px-4 max-w-4xl">
          <div className="space-y-8">
            {/* Profile Header */}
            <Card className="bg-slate-800/50 border-blue-800/30 backdrop-blur-sm">
              <CardHeader>
                <div className="flex flex-col sm:flex-row items-start sm:items-center gap-6">
                  <Avatar className="h-24 w-24">
                    <AvatarImage
                      src={`https://api.dicebear.com/7.x/initials/svg?seed=${
                        user?.name || user?.email
                      }`}
                      alt={user?.name || "User"}
                    />
                    <AvatarFallback className="text-2xl">
                      {user?.name?.charAt(0) ||
                        user?.email?.charAt(0).toUpperCase() ||
                        "U"}
                    </AvatarFallback>
                  </Avatar>

                  <div className="flex-1 space-y-2">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                      <div>
                        <h1 className="text-3xl font-bold text-white">
                          {user?.name || "User"}
                        </h1>
                      </div>

                      <Dialog
                        open={isEditDialogOpen}
                        onOpenChange={setIsEditDialogOpen}
                      >
                        <DialogTrigger asChild>
                          <Button className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white">
                            <Edit2 className="h-4 w-4" />
                            Edit Profile
                          </Button>
                        </DialogTrigger>
                        <DialogContent className="sm:max-w-[425px]">
                          <DialogHeader>
                            <DialogTitle>Edit Profile</DialogTitle>
                            <DialogDescription>
                              Make changes to your profile here. Click save when
                              you&apos;re done.
                            </DialogDescription>
                          </DialogHeader>
                          <form
                            onSubmit={handleEditSubmit}
                            className="space-y-4"
                          >
                            <div className="space-y-2">
                              <Label htmlFor="name">Display Name</Label>
                              <Input
                                id="name"
                                name="name"
                                value={editForm.name}
                                onChange={handleInputChange}
                                placeholder="Enter your display name"
                              />
                            </div>
                            <div className="flex justify-end gap-2">
                              <Button
                                type="button"
                                variant="outline"
                                onClick={() => setIsEditDialogOpen(false)}
                              >
                                Cancel
                              </Button>
                              <Button type="submit">Save Changes</Button>
                            </div>
                          </form>
                        </DialogContent>
                      </Dialog>
                    </div>
                  </div>
                </div>
              </CardHeader>
            </Card>

            {/* Questions Solved Statistics */}
            <Card className="bg-slate-800/50 border-blue-800/30 backdrop-blur-sm">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-white">
                  <Trophy className="h-5 w-5 text-yellow-500" />
                  Questions Solved
                </CardTitle>
                <CardDescription className="text-gray-200">
                  Your coding journey progress
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
                  {/* Total Questions */}
                  <div className="text-center space-y-2">
                    <div className="flex justify-center">
                      <div className="h-16 w-16 rounded-full bg-blue-300 flex items-center justify-center">
                        <Target className="h-8 w-8 text-primary" />
                      </div>
                    </div>
                    <div>
                      <p className="text-3xl font-bold text-blue-300">
                        {questionsStats.total}
                      </p>
                      <p className="text-sm text-gray-200">Total Solved</p>
                    </div>
                  </div>

                  {/* Easy Questions */}
                  <div className="text-center space-y-2">
                    <div className="flex justify-center">
                      <div className="h-16 w-16 rounded-full bg-green-100 flex items-center justify-center">
                        <Badge className="bg-green-500 hover:bg-green-600 text-white text-lg px-3 py-1">
                          E
                        </Badge>
                      </div>
                    </div>
                    <div>
                      <p className="text-3xl font-bold text-green-600">
                        {questionsStats.easy}
                      </p>
                      <p className="text-sm text-gray-200">Easy</p>
                    </div>
                  </div>

                  {/* Medium Questions */}
                  <div className="text-center space-y-2">
                    <div className="flex justify-center">
                      <div className="h-16 w-16 rounded-full bg-yellow-100 flex items-center justify-center">
                        <Badge className="bg-yellow-500 hover:bg-yellow-600 text-white text-lg px-3 py-1">
                          M
                        </Badge>
                      </div>
                    </div>
                    <div>
                      <p className="text-3xl font-bold text-yellow-600">
                        {questionsStats.medium}
                      </p>
                      <p className="text-sm text-gray-200">Medium</p>
                    </div>
                  </div>

                  {/* Hard Questions */}
                  <div className="text-center space-y-2">
                    <div className="flex justify-center">
                      <div className="h-16 w-16 rounded-full bg-red-100 flex items-center justify-center">
                        <Badge className="bg-red-500 hover:bg-red-600 text-white text-lg px-3 py-1">
                          H
                        </Badge>
                      </div>
                    </div>
                    <div>
                      <p className="text-3xl font-bold text-red-600">
                        {questionsStats.hard}
                      </p>
                      <p className="text-sm text-gray-200">Hard</p>
                    </div>
                  </div>
                </div>

                <Separator className="my-6" />

                {/* Progress Bars */}
                <div className="space-y-4">
                  <div className="space-y-2">
                    <div className="flex justify-between text-sm">
                      <span className="text-green-600 font-medium">Easy</span>
                      <span className="text-gray-200">
                        {questionsStats.easy}/{questionsStats.total}
                      </span>
                    </div>
                    <div className="w-full bg-gray-200 rounded-full h-2">
                      <div
                        className="bg-green-500 h-2 rounded-full"
                        style={{
                          width: `${
                            (questionsStats.easy / questionsStats.total) * 100
                          }%`,
                        }}
                      ></div>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <div className="flex justify-between text-sm">
                      <span className="text-yellow-600 font-medium">
                        Medium
                      </span>
                      <span className="text-gray-200">
                        {questionsStats.medium}/{questionsStats.total}
                      </span>
                    </div>
                    <div className="w-full bg-gray-200 rounded-full h-2">
                      <div
                        className="bg-yellow-500 h-2 rounded-full"
                        style={{
                          width: `${
                            (questionsStats.medium / questionsStats.total) * 100
                          }%`,
                        }}
                      ></div>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <div className="flex justify-between text-sm">
                      <span className="text-red-600 font-medium">Hard</span>
                      <span className="text-gray-200">
                        {questionsStats.hard}/{questionsStats.total}
                      </span>
                    </div>
                    <div className="w-full bg-gray-200 rounded-full h-2">
                      <div
                        className="bg-red-500 h-2 rounded-full"
                        style={{
                          width: `${
                            (questionsStats.hard / questionsStats.total) * 100
                          }%`,
                        }}
                      ></div>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </main>
      <Footer />
    </div>
  );
}
