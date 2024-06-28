import { useQuery } from "@tanstack/react-query";
import useAxiosSecure from "./useAxiosSecure";

const useCategory = () => {
  const axiosSecure = useAxiosSecure();
  const {
    data: categories = [],
    isLoading,
    refetch,
  } = useQuery({
    queryKey: ["categories"],
    queryFn: async () => {
      const res = await axiosSecure.get(`/category`);
      return res.data;
    },
  });

  return { categories, isLoading, refetch };
};

export default useCategory;
