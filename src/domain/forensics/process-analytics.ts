export type AnalyticsSegment={sessionId:string;startedAt:string;updatedAt:string;eventCount:number;status:"sealed"|"interrupted";eventTimes:readonly string[]};
export type ProcessAnalytics={sessions:number;interruptedSegments:number;events:number;segmentDurationMs:number;activeTransactionSpanMs:number;byUtcDate:readonly{date:string;sessions:number;events:number;segmentDurationMs:number}[]};
export function buildProcessAnalytics(segments:readonly AnalyticsSegment[],options:{idleThresholdMs:number}):ProcessAnalytics{
 if(!Number.isFinite(options.idleThresholdMs)||options.idleThresholdMs<=0)throw new Error("buildProcessAnalytics: invalid idle threshold");
 let events=0,segmentDurationMs=0,activeTransactionSpanMs=0,interruptedSegments=0;const days=new Map<string,{date:string;sessions:number;events:number;segmentDurationMs:number}>();
 for(const s of segments){const start=Date.parse(s.startedAt),end=Date.parse(s.updatedAt);if(!Number.isFinite(start)||!Number.isFinite(end)||end<start)throw new Error("buildProcessAnalytics: invalid segment time");if(!Number.isSafeInteger(s.eventCount)||s.eventCount<0||s.eventTimes.length!==s.eventCount)throw new Error("buildProcessAnalytics: invalid event count");events+=s.eventCount;segmentDurationMs+=end-start;if(s.status==="interrupted")interruptedSegments++;
  const times=s.eventTimes.map(Date.parse);for(const t of times)if(!Number.isFinite(t)||t<start||t>end)throw new Error("buildProcessAnalytics: invalid event time");for(let i=1;i<times.length;i++){const d=times[i]-times[i-1];if(d<0)throw new Error("buildProcessAnalytics: non-monotonic events");if(d<=options.idleThresholdMs)activeTransactionSpanMs+=d;}
  const date=s.startedAt.slice(0,10);const d=days.get(date)??{date,sessions:0,events:0,segmentDurationMs:0};d.sessions++;d.events+=s.eventCount;d.segmentDurationMs+=end-start;days.set(date,d);
 }
 return{sessions:segments.length,interruptedSegments,events,segmentDurationMs,activeTransactionSpanMs,byUtcDate:[...days.values()].sort((a,b)=>a.date.localeCompare(b.date))};
}
