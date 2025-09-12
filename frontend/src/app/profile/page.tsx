'use client';

import { useState, useRef, useEffect } from 'react';
import { AppSidebar } from "@/components/app-sidebar"
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Separator } from '@/components/ui/separator';
import { 
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '@/components/ui/breadcrumb';
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import { Upload, User, Mail, Phone, MapPin, Building, Globe, Save } from 'lucide-react';
import { toast } from 'sonner';

export default function ProfilePage() {
  const [profile, setProfile] = useState({
    name: '',
    email: '',
    phone: '',
    bio: '',
    location: '',
    company: '',
    website: '',
    avatar: '',
  });
  
  const [isLoading, setIsLoading] = useState(false);
  const [isLoadingProfile, setIsLoadingProfile] = useState(true);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Load profile data on mount
  useEffect(() => {
    const loadProfile = async () => {
      try {
        const response = await fetch('http://localhost:3001/api/profile');
        if (response.ok) {
          const data = await response.json();
          setProfile({
            name: data.name || '',
            email: data.email || '',
            phone: data.phone || '',
            bio: data.bio || '',
            location: data.location || '',
            company: data.company || '',
            website: data.website || '',
            avatar: data.avatar || '',
          });
        }
      } catch (error) {
        console.error('Failed to load profile:', error);
        toast.error('Failed to load profile');
      } finally {
        setIsLoadingProfile(false);
      }
    };

    loadProfile();
  }, []);

  const handleInputChange = (field: string, value: string) => {
    setProfile(prev => ({ ...prev, [field]: value }));
  };

  const handleAvatarUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      if (file.size > 5 * 1024 * 1024) { // 5MB limit
        toast.error('Image size should be less than 5MB');
        return;
      }
      
      try {
        setIsLoading(true);
        const formData = new FormData();
        formData.append('file', file);
        
        const response = await fetch('http://localhost:3001/api/uploads/avatar', {
          method: 'POST',
          body: formData,
        });
        
        if (response.ok) {
          const data = await response.json();
          const avatarUrl = `http://localhost:3001${data.url}`;
          setProfile(prev => ({ ...prev, avatar: avatarUrl }));
          toast.success('Avatar uploaded successfully');
        } else {
          toast.error('Failed to upload avatar');
        }
      } catch (error) {
        console.error('Avatar upload error:', error);
        toast.error('Failed to upload avatar');
      } finally {
        setIsLoading(false);
      }
    }
  };

  const handleSave = async () => {
    setIsLoading(true);
    try {
      const response = await fetch('http://localhost:3001/api/profile', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(profile),
      });
      
      if (response.ok) {
        toast.success('Profile updated successfully!');
      } else {
        toast.error('Failed to update profile');
      }
    } catch (error) {
      console.error('Profile save error:', error);
      toast.error('Failed to update profile');
    } finally {
      setIsLoading(false);
    }
  };

  if (isLoadingProfile) {
    return (
      <SidebarProvider>
        <AppSidebar />
        <SidebarInset>
          <header className="flex h-12 shrink-0 items-center gap-2 transition-[width,height] ease-linear group-has-data-[collapsible=icon]/sidebar-wrapper:h-10">
            <div className="flex items-center gap-2 px-2">
              <SidebarTrigger className="-ml-1" />
              <Separator orientation="vertical" className="mr-2 data-[orientation=vertical]:h-4" />
              <Breadcrumb>
                <BreadcrumbList>
                  <BreadcrumbItem className="hidden md:block">
                    <BreadcrumbLink href="/dashboard">Dashboard</BreadcrumbLink>
                  </BreadcrumbItem>
                  <BreadcrumbSeparator className="hidden md:block" />
                  <BreadcrumbItem>
                    <BreadcrumbPage>Profile</BreadcrumbPage>
                  </BreadcrumbItem>
                </BreadcrumbList>
              </Breadcrumb>
            </div>
          </header>
          <div className="flex flex-1 flex-col gap-4 p-4 pt-0">
            <Card>
              <CardContent className="p-6">
                <div className="flex items-center justify-center h-32">
                  <div className="text-muted-foreground">Loading profile...</div>
                </div>
              </CardContent>
            </Card>
          </div>
        </SidebarInset>
      </SidebarProvider>
    );
  }

  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset>
        <header className="flex h-12 shrink-0 items-center gap-2 transition-[width,height] ease-linear group-has-data-[collapsible=icon]/sidebar-wrapper:h-10">
          <div className="flex items-center gap-2 px-2">
            <SidebarTrigger className="-ml-1" />
            <Separator orientation="vertical" className="mr-2 data-[orientation=vertical]:h-4" />
            <Breadcrumb>
              <BreadcrumbList>
                <BreadcrumbItem className="hidden md:block">
                  <BreadcrumbLink href="/dashboard">Dashboard</BreadcrumbLink>
                </BreadcrumbItem>
                <BreadcrumbSeparator className="hidden md:block" />
                <BreadcrumbItem>
                  <BreadcrumbPage>Profile</BreadcrumbPage>
                </BreadcrumbItem>
              </BreadcrumbList>
            </Breadcrumb>
          </div>
        </header>
        <div className="flex flex-1 flex-col gap-4 p-4 pt-0">

      <div className="grid gap-6 animate-in fade-in-0 slide-in-from-bottom-2 duration-300" style={{ animationDelay: '100ms' }}>
        <Card>
          <CardHeader>
            <CardTitle>Personal Information</CardTitle>
            <CardDescription>
              Update your personal details so your AI agent knows who you are and can personalize responses.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            {/* Avatar Section */}
            <div className="flex items-center gap-6">
              <Avatar className="h-24 w-24">
                <AvatarImage src={profile.avatar} alt={profile.name || 'Profile'} />
                <AvatarFallback className="text-lg">
                  {profile.name ? profile.name.charAt(0).toUpperCase() : <User className="h-8 w-8" />}
                </AvatarFallback>
              </Avatar>
              <div className="space-y-2">
                <Label htmlFor="avatar-upload" className="text-sm font-medium">
                  Profile Photo
                </Label>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => fileInputRef.current?.click()}
                  >
                    <Upload className="h-4 w-4 mr-2" />
                    Upload Photo
                  </Button>
                  {profile.avatar && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setProfile(prev => ({ ...prev, avatar: '' }))}
                    >
                      Remove
                    </Button>
                  )}
                </div>
                <p className="text-xs text-muted-foreground">
                  JPG, PNG or GIF. Max size 5MB.
                </p>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  onChange={handleAvatarUpload}
                  className="hidden"
                />
              </div>
            </div>

            <Separator />

            {/* Basic Information */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="name">
                  <User className="h-4 w-4 inline mr-2" />
                  Full Name
                </Label>
                <Input
                  id="name"
                  placeholder="Enter your full name"
                  value={profile.name}
                  onChange={(e) => handleInputChange('name', e.target.value)}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="email">
                  <Mail className="h-4 w-4 inline mr-2" />
                  Email
                </Label>
                <Input
                  id="email"
                  type="email"
                  placeholder="Enter your email"
                  value={profile.email}
                  onChange={(e) => handleInputChange('email', e.target.value)}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="phone">
                  <Phone className="h-4 w-4 inline mr-2" />
                  Phone
                </Label>
                <Input
                  id="phone"
                  placeholder="Enter your phone number"
                  value={profile.phone}
                  onChange={(e) => handleInputChange('phone', e.target.value)}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="location">
                  <MapPin className="h-4 w-4 inline mr-2" />
                  Location
                </Label>
                <Input
                  id="location"
                  placeholder="City, Country"
                  value={profile.location}
                  onChange={(e) => handleInputChange('location', e.target.value)}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="company">
                  <Building className="h-4 w-4 inline mr-2" />
                  Company
                </Label>
                <Input
                  id="company"
                  placeholder="Your company or organization"
                  value={profile.company}
                  onChange={(e) => handleInputChange('company', e.target.value)}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="website">
                  <Globe className="h-4 w-4 inline mr-2" />
                  Website
                </Label>
                <Input
                  id="website"
                  placeholder="https://yourwebsite.com"
                  value={profile.website}
                  onChange={(e) => handleInputChange('website', e.target.value)}
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="bio">Bio</Label>
              <Textarea
                id="bio"
                placeholder="Tell your AI agent about yourself, your role, preferences, and anything that would help it assist you better..."
                className="min-h-[100px]"
                value={profile.bio}
                onChange={(e) => handleInputChange('bio', e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                This information helps your AI agent understand your context and provide more personalized assistance.
              </p>
            </div>

            <Separator />

            <div className="flex justify-end">
              <Button onClick={handleSave} disabled={isLoading}>
                <Save className="h-4 w-4 mr-2" />
                {isLoading ? 'Saving...' : 'Save Profile'}
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
        </div>
      </SidebarInset>
    </SidebarProvider>
  );
}
