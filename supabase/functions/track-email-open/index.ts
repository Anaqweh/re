import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';

const GIF_1X1 = Uint8Array.from(
  atob('R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw=='),
  (c) => c.charCodeAt(0),
);

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
};

function gifResponse() {
  return new Response(GIF_1X1, {
    status: 200,
    headers: {
      ...corsHeaders,
      'Content-Type': 'image/gif',
      'Cache-Control': 'no-store, no-cache, must-revalidate',
    },
  });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  if (req.method !== 'GET') {
    return gifResponse();
  }

  const url = new URL(req.url);
  const messageId = url.searchParams.get('id')?.trim();

  if (!messageId) {
    return gifResponse();
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

  if (!supabaseUrl || !serviceRoleKey) {
    return gifResponse();
  }

  try {
    const supabase = createClient(supabaseUrl, serviceRoleKey);
    const now = new Date().toISOString();

    const { data: existing } = await supabase
      .from('trainee_messages')
      .select('open_count, opened_at')
      .eq('id', messageId)
      .maybeSingle();

    if (existing) {
      await supabase
        .from('trainee_messages')
        .update({
          opened_at: existing.opened_at || now,
          open_count: (existing.open_count || 0) + 1,
          status: 'opened',
        })
        .eq('id', messageId);
    }
  } catch (error) {
    console.error('track-email-open error:', error);
  }

  return gifResponse();
});
