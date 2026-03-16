import React from "react";
import { useListAreas } from "@workspace/api-client-react";
import { Link } from "wouter";
import { MapPin, ChevronRight } from "lucide-react";
import { StatusBadge } from "@/components/ui/StatusBadge";

export default function AreasList() {
  const { data: areas, isLoading } = useListAreas();

  if (isLoading) {
    return <div className="p-8 text-center text-slate-500 animate-pulse">Loading areas...</div>;
  }

  // Group by terminal
  const groupedAreas = areas?.reduce((acc: any, area) => {
    if (!acc[area.terminal]) acc[area.terminal] = [];
    acc[area.terminal].push(area);
    return acc;
  }, {});

  return (
    <div className="space-y-8 max-w-5xl mx-auto pb-12">
      <div>
        <h1 className="text-3xl font-display font-bold text-slate-900">Cleaning Zones</h1>
        <p className="text-slate-500 mt-2 font-medium">Select an area to view and manage daily tasks.</p>
      </div>

      <div className="space-y-10">
        {groupedAreas && Object.entries(groupedAreas).map(([terminal, terminalAreas]: [string, any]) => (
          <div key={terminal} className="animate-fade-in-up">
            <div className="flex items-center gap-3 mb-4 border-b border-slate-200 pb-2">
              <MapPin className="w-5 h-5 text-accent" />
              <h2 className="text-xl font-display font-bold text-slate-800">{terminal}</h2>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {terminalAreas.map((area: any) => (
                <Link key={area.id} href={`/areas/${area.id}`}>
                  <div className="bg-white rounded-2xl p-5 border border-slate-200 shadow-sm hover:shadow-md hover:border-accent hover:-translate-y-1 transition-all duration-200 group cursor-pointer flex items-center justify-between">
                    <div>
                      <h3 className="font-bold text-lg text-slate-900 group-hover:text-accent transition-colors">{area.name}</h3>
                      <p className="text-sm text-slate-500 mt-1">{area.location}</p>
                    </div>
                    <div className="w-10 h-10 rounded-full bg-slate-50 flex items-center justify-center group-hover:bg-accent group-hover:text-white text-slate-400 transition-colors">
                      <ChevronRight className="w-5 h-5" />
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
