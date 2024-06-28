import { useQuery } from "@tanstack/react-query";
import useAxiosPublic from "./useAxiosPublic";

const useApprovedAds = () => {
  const axiosPublic = useAxiosPublic();

  const {
    data: adsProducts = [],
    isLoading: loading,
    error,
    refetch,
  } = useQuery({
    queryKey: ["adsProducts"],
    queryFn: async () => {
      let url = "https://hossain-farma-server.vercel.app/seller/ads";
      const res = await axiosPublic.get(url);
      return res.data;
    },
  });

  return [adsProducts, refetch, loading, error];
};

export default useApprovedAds;
