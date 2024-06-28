import { useQuery } from "@tanstack/react-query";
// import useAxiosPublic from "./useAxiosPublic";
import useAxiosSecure from "./useAxiosSecure";

const useAdminAds = () => {
  // const axiosPublic = useAxiosPublic();
  const axiosSecure = useAxiosSecure();

  const {
    data: adsProducts = [],
    isLoading: loading,
    error,
    refetch,
  } = useQuery({
    queryKey: ["adsProducts"],
    queryFn: async () => {
      let url = "https://hossain-farma-server.vercel.app/admin/ads";
      const res = await axiosSecure.get(url);
      return res.data;
    },
  });

  return [adsProducts, refetch, loading, error];
};

export default useAdminAds;
